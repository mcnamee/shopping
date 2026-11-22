/**
 * Stage 3 routes (docs/api.md, docs/stage-3.md C1 to C3, D-061 to D-073):
 * - POST /api/lists/{listId}/suggestions and POST /api/suggestions: read-only suggestions.
 * - POST /api/lists/{listId}/items/bulk: add many items with per-item results (for the
 *   review sheet's confirm and its Undo).
 * Household comes only from verified claims; another household's list is 404.
 */
import {
  isValidEntityId,
  lineIdFor,
  localDate,
  MAX_SUGGESTIONS,
  parseAddItemRequest,
  snapshotOf,
  suggestCandidates,
  type BulkAddItemResult,
  type BulkAddItemsResponse,
  type LineInput,
  type ProductSnapshot,
  type Suggestion,
  type SuggestionCandidate,
  type SuggestionsResponse,
  type SuggestionSource,
  type UnitType,
} from '@trolley/core';
import { fail, json, readJsonBody, type HttpResult } from '../http';
import type { ListStore } from '../lists/store';
import type { ProductResolver } from '../products/resolver';
import type { AuthedRequest, RouteTable } from '../router';
import type { SettingsStore } from '../settings/store';
import type { TemplateStore } from '../templates/store';
import { applyAiPicks, buildPrompt, parseAiReply } from './ai';
import type { AiTextModel } from './bedrock';
import type { SuggestionStore } from './store';

export interface Stage3Deps {
  lists: ListStore;
  templates: TemplateStore;
  settings: SettingsStore;
  suggestions: SuggestionStore;
  resolveProduct: ProductResolver;
  /** Null: rules only (no model configured). */
  ai: AiTextModel | null;
  /** AI pass budget before falling back to the rules result (B5). */
  aiTimeoutMs: number;
  now: () => Date;
  /** Structured warning log (defaults to console.warn of one JSON line). */
  warn?: (entry: Record<string, unknown>) => void;
}

export const AI_TIMEOUT_MS = 8000;
export const RATE_LIMIT_MESSAGE = "You've used today's suggestions - try again tomorrow.";
/** Items in one bulk add (the review sheet holds at most 40). */
export const BULK_ADD_MAX = 50;
/** Candidates computed before snapshots are resolved (unresolvable ones are dropped). */
const CANDIDATE_POOL = 200;

type Resolved = SuggestionCandidate & { snapshot: ProductSnapshot };

const defaultWarn = (entry: Record<string, unknown>) =>
  console.warn(JSON.stringify({ level: 'warn', ...entry }));

class AiTimeout extends Error {
  override name = 'AiTimeout';
}

export function createSuggestionRoutes(getDeps: () => Stage3Deps): RouteTable {
  const hhOf = (req: AuthedRequest) => req.household.householdId;

  /** Snapshots for display: the template line's, else the product as the household sees it. */
  async function resolveSnapshots(hh: string, cands: SuggestionCandidate[]): Promise<Resolved[]> {
    const { resolveProduct } = getDeps();
    const resolved = await Promise.all(
      cands.map(async (c): Promise<Resolved | null> => {
        if (c.templateProduct) return { ...c, snapshot: c.templateProduct };
        const p = await resolveProduct(hh, c.productId);
        if (!p) return null; // e.g. a custom product that no longer exists
        return { ...c, snapshot: snapshotOf({ ...p, unitType: p.defaultUnitType ?? p.unitType }) };
      }),
    );
    return resolved.filter((r): r is Resolved => r !== null).slice(0, MAX_SUGGESTIONS);
  }

  /** The AI pass; any failure returns null (the caller keeps the rules result). */
  async function aiPass(cands: Resolved[], today: string): Promise<Resolved[] | null> {
    const { ai, aiTimeoutMs } = getDeps();
    const warn = getDeps().warn ?? defaultWarn;
    if (!ai) return null;
    const prompt = buildPrompt(cands, today);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    try {
      const text = await Promise.race([
        ai(prompt, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new AiTimeout());
          }, aiTimeoutMs);
        }),
      ]);
      const parsed = parseAiReply(text, prompt, cands);
      if (!parsed.ok) {
        warn({ msg: 'suggestions_ai_fallback', reason: parsed.reason, ms: Date.now() - started });
        return null;
      }
      return applyAiPicks(cands, parsed.picks);
    } catch (err) {
      // Error name only: never product data, prompts or model output in logs (B5).
      const reason = err instanceof AiTimeout ? 'timeout' : 'error';
      warn({
        msg: 'suggestions_ai_fallback',
        reason,
        error: err instanceof Error ? err.name : typeof err,
        ms: Date.now() - started,
      });
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function suggest(req: AuthedRequest, listId: string | null): Promise<HttpResult> {
    const hh = hhOf(req);
    const deps = getDeps();
    let exclude: string[] = [];
    if (listId !== null) {
      await deps.lists.mustGetActive(hh, listId);
      exclude = (await deps.lists.items(hh, listId)).map((i) => i.product.productId);
    }
    const now = deps.now();
    const today = localDate(now);
    // Counted before any work, cold start included (D-066).
    if (!(await deps.suggestions.consumeRun(hh, today, now.getTime()))) {
      return fail.rateLimited(RATE_LIMIT_MESSAGE);
    }
    const [purchases, templates, aisle] = await Promise.all([
      deps.suggestions.purchases(hh),
      deps.templates.list(hh),
      deps.settings.aisleOrder(hh),
    ]);
    const result = suggestCandidates({
      purchases,
      templates,
      exclude,
      today,
      aisleOrder: aisle.order,
      limit: CANDIDATE_POOL,
    });
    const rules = await resolveSnapshots(hh, result.candidates);
    // Cold start skips Bedrock: template items need no ranking (D-071).
    const ai = !result.coldStart && rules.length > 0 ? await aiPass(rules, today) : null;
    const source: SuggestionSource = ai ? 'ai' : 'rules';
    const suggestions: Suggestion[] = (ai ?? rules).map((c) => ({
      productId: c.productId,
      snapshot: c.snapshot,
      qty: c.qty,
      unit: c.unit,
      note: c.note,
      reason: c.reason,
      fromTemplate: c.fromTemplate,
      fromHistory: c.origin !== 'template',
    }));
    return json(200, {
      source,
      coldStart: result.coldStart,
      note: result.note,
      suggestions,
    } satisfies SuggestionsResponse);
  }

  async function listSuggestions(req: AuthedRequest): Promise<HttpResult> {
    const id = req.event.pathParameters?.listId;
    return suggest(req, isValidEntityId(id) ? id : fail.notFound());
  }

  // ------------------------------------------------------------------ bulk add

  async function bulkAdd(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = req.event.pathParameters?.listId;
    const listId = isValidEntityId(id) ? id : fail.notFound();
    const body = readJsonBody(req.event);
    const raw = (body as { items?: unknown } | undefined)?.items;
    if (typeof body !== 'object' || body === null || !Array.isArray(raw)) {
      return fail.validation('items must be a list', 'items');
    }
    if (raw.length < 1 || raw.length > BULK_ADD_MAX) {
      return fail.validation(`Add 1 to ${BULK_ADD_MAX} items at a time`, 'items');
    }
    const { lists, resolveProduct } = getDeps();
    await lists.mustGetActive(hh, listId);

    const results: Array<BulkAddItemResult | null> = raw.map(() => null);
    const toAdd: Array<{ index: number; line: LineInput }> = [];
    const seen = new Set<string>();
    const refOf = (v: unknown) => {
      const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
      return {
        productId: typeof r.productId === 'string' ? r.productId.slice(0, 64) : '',
        unit: (typeof r.unit === 'string' ? r.unit : 'each') as UnitType,
      };
    };
    await Promise.all(
      raw.map(async (entry, index) => {
        const parsed = parseAddItemRequest(entry);
        if (!parsed.ok) {
          results[index] = {
            ok: false,
            ...refOf(entry),
            code: 'VALIDATION',
            message: parsed.message,
          };
          return;
        }
        const input = parsed.value;
        const key = lineIdFor(input.productId, input.unit);
        if (seen.has(key)) {
          results[index] = {
            ok: false,
            productId: input.productId,
            unit: input.unit,
            code: 'VALIDATION',
            message: 'This product and unit is already in the request.',
          };
          return;
        }
        seen.add(key);
        const p = await resolveProduct(hh, input.productId);
        if (!p) {
          results[index] = {
            ok: false,
            productId: input.productId,
            unit: input.unit,
            code: 'VALIDATION',
            message: 'That product is not in the catalogue',
          };
          return;
        }
        toAdd.push({
          index,
          line: {
            product: snapshotOf({ ...p, unitType: p.defaultUnitType ?? p.unitType }),
            qty: input.qty,
            unit: input.unit,
            note: input.note,
          },
        });
      }),
    );
    toAdd.sort((a, b) => a.index - b.index);
    const outcomes = await lists.addEach(
      hh,
      req.household.userId,
      listId,
      toAdd.map((t) => t.line),
    );
    outcomes.forEach((o, i) => {
      const { index, line } = toAdd[i] as { index: number; line: LineInput };
      const ref = { productId: line.product.productId, unit: line.unit };
      results[index] = o.ok
        ? { ok: true, ...ref, change: o.change }
        : { ok: false, ...ref, code: o.code, message: o.message };
    });
    const final = results as BulkAddItemResult[];
    const added = final.filter((r) => r.ok).length;
    return json(200, {
      list: await lists.detail(hh, listId),
      results: final,
      added,
      failed: final.length - added,
    } satisfies BulkAddItemsResponse);
  }

  const r = (handler: (req: AuthedRequest) => Promise<HttpResult>) => ({
    auth: true as const,
    handler,
  });

  return {
    'POST /api/lists/{listId}/suggestions': r(listSuggestions),
    'POST /api/suggestions': r((req) => suggest(req, null)),
    'POST /api/lists/{listId}/items/bulk': r(bulkAdd),
  };
}
