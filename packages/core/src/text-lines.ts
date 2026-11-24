/**
 * Free-text list lines (Stage 5, D-103): a list line that is just words ("2 cups plain
 * flour"), not a catalogue product. They use the ListItem shape so shop grouping and the
 * list UI work unchanged, with `kind: 'text'` marking the differences:
 *
 * - id `TEXT~<hash of the trimmed, whitespace-collapsed text>`, so only exactly the same
 *   text merges (case matters; "Flour" and "flour" are two lines),
 * - `product` is a synthetic snapshot: name = the text, productId = the line id, group as
 *   chosen (guessGroup by default), unit each, qty 1,
 * - never a purchase row, never in suggestions or usual-product resolution.
 */
import { guessGroup } from './ingredient-groups';
import { isDefaultGroupId, OTHER_GROUP_ID } from './groups';
import type { LineInput, Parsed, ProductSnapshot } from './lists';
import { cleanText } from './lists';

export const TEXT_LINE_MAX_LENGTH = 200;
export const TEXT_ID_PREFIX = 'TEXT~';
const TEXT_ID_PATTERN = /^TEXT~[0-9a-f]{16}$/;

/** Trim, collapse whitespace and strip control characters. The identity of a text line. */
export function normaliseLineText(value: string): string {
  return cleanText(value);
}

/** cyrb53-style 53-bit hash, as 14 hex digits padded to 16. Sync, so the mock can use it. */
function hash16(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h2) + hex(h1);
}

/** `TEXT~<hash>` of already-normalised text. */
export function textLineId(normalisedText: string): string {
  return `${TEXT_ID_PREFIX}${hash16(normalisedText)}`;
}

export function isTextLineId(value: unknown): value is string {
  return typeof value === 'string' && TEXT_ID_PATTERN.test(value);
}

/** True for a text line (list item, or a LineInput being added). */
export function isTextLine(l: { kind?: string | undefined }): boolean {
  return l.kind === 'text';
}

/** The synthetic product snapshot of a text line. */
export function textSnapshot(normalisedText: string, groupId: string): ProductSnapshot {
  return {
    productId: textLineId(normalisedText),
    name: normalisedText,
    brand: null,
    imageUrl: null,
    packSize: null,
    groupId: isDefaultGroupId(groupId) ? groupId : OTHER_GROUP_ID,
    unitType: 'each',
  };
}

/** A LineInput for adding free text (qty 1, unit each). Group defaults to guessGroup. */
export function textLineInput(
  text: string,
  opts: { groupId?: string | null | undefined; note?: string | null | undefined } = {},
): LineInput {
  const t = normaliseLineText(text);
  return {
    kind: 'text',
    product: textSnapshot(t, opts.groupId ?? guessGroup(t)),
    qty: 1,
    unit: 'each',
    note: opts.note ?? null,
  };
}

/** Text typed or sent as a line: 1..TEXT_LINE_MAX_LENGTH characters once normalised. */
export function parseLineText(value: unknown, field = 'text'): Parsed<string> {
  const t = typeof value === 'string' ? normaliseLineText(value) : '';
  if (!t) return { ok: false, message: 'Enter some text.', field };
  if (t.length > TEXT_LINE_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep it to ${TEXT_LINE_MAX_LENGTH} characters or fewer.`,
      field,
    };
  }
  return { ok: true, value: t };
}

export function parseTextGroup(value: unknown): Parsed<string> {
  return isDefaultGroupId(value)
    ? { ok: true, value }
    : { ok: false, message: 'Choose a group', field: 'groupId' };
}
