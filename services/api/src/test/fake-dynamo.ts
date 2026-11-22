/**
 * In-memory DynamoDB for API tests: Get/Put/Update/Delete/Query/BatchWrite/TransactWrite
 * on a pk+sk table with GSI1 and GSI2, evaluating the condition and update expression
 * subset the stores use (comparisons, AND/OR/NOT, attribute_exists, attribute_not_exists,
 * begins_with, SET with + / - and if_not_exists, REMOVE, nested map paths).
 *
 * Each command runs atomically after a random 0-2 ms delay, so Promise.all of requests
 * interleaves like concurrent Lambda invocations. Transactions are all-or-nothing and
 * report CancellationReasons like DynamoDB; two ops on one item in a transaction and
 * scans throw, as they would (or should) in production.
 */
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DocSender } from '../products/doc';

type Item = Record<string, unknown>;
type Names = Record<string, string> | undefined;
type Values = Record<string, unknown> | undefined;

const INDEXES: Record<string, { pk: string; sk: string }> = {
  GSI1: { pk: 'gsi1pk', sk: 'gsi1sk' },
  GSI2: { pk: 'gsi2pk', sk: 'gsi2sk' },
};

function named(name: string, message = name, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { name, ...extra });
}

const clone = <T>(v: T): T => structuredClone(v);

// ------------------------------------------------------------------ expressions

const TOKEN = /\s*(#[A-Za-z0-9_]+|:[A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_]*|<>|<=|>=|[=<>(),.+-])/y;

function tokenise(expr: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (TOKEN.lastIndex < expr.length && (m = TOKEN.exec(expr))) out.push(m[1] as string);
  if (expr.slice(TOKEN.lastIndex).trim()) throw new Error(`Cannot parse expression: ${expr}`);
  return out;
}

class Parser {
  i = 0;
  constructor(
    readonly t: string[],
    readonly names: Names,
    readonly values: Values,
  ) {}
  peek(o = 0) {
    return this.t[this.i + o];
  }
  next() {
    const v = this.t[this.i++];
    if (v === undefined) throw new Error('Unexpected end of expression');
    return v;
  }
  expect(v: string) {
    const got = this.next();
    if (got !== v) throw new Error(`Expected ${v}, got ${got}`);
  }
  kw(v: string) {
    return this.peek()?.toUpperCase() === v;
  }
  path(): string[] {
    const segs = [this.segment()];
    while (this.peek() === '.') {
      this.next();
      segs.push(this.segment());
    }
    return segs;
  }
  segment(): string {
    const tok = this.next();
    if (tok.startsWith('#')) {
      const n = this.names?.[tok];
      if (n === undefined) throw new Error(`Missing name ${tok}`);
      return n;
    }
    if (!/^[A-Za-z_]/.test(tok)) throw new Error(`Bad path segment ${tok}`);
    return tok;
  }
  value(tok: string): unknown {
    if (!this.values || !(tok in this.values)) throw new Error(`Missing value ${tok}`);
    return this.values[tok];
  }
}

function getPath(item: Item, path: string[]): unknown {
  let cur: unknown = item;
  for (const seg of path) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

type Cond = (item: Item) => boolean;
type Operand = (item: Item) => unknown;

function parseCondition(expr: string, names: Names, values: Values): Cond {
  const p = new Parser(tokenise(expr), names, values);
  const c = orExpr(p);
  if (p.i !== p.t.length) throw new Error(`Trailing tokens in ${expr}`);
  return c;
}

function orExpr(p: Parser): Cond {
  let left = andExpr(p);
  while (p.kw('OR')) {
    p.next();
    const l = left;
    const r = andExpr(p);
    left = (it) => l(it) || r(it);
  }
  return left;
}

function andExpr(p: Parser): Cond {
  let left = notExpr(p);
  while (p.kw('AND')) {
    p.next();
    const l = left;
    const r = notExpr(p);
    left = (it) => l(it) && r(it);
  }
  return left;
}

function notExpr(p: Parser): Cond {
  if (p.kw('NOT')) {
    p.next();
    const inner = notExpr(p);
    return (it) => !inner(it);
  }
  return primary(p);
}

function operand(p: Parser): Operand {
  const tok = p.peek() as string;
  if (tok.startsWith(':')) {
    p.next();
    const v = p.value(tok);
    return () => v;
  }
  if (tok === 'size' && p.peek(1) === '(') {
    p.next();
    p.expect('(');
    const path = p.path();
    p.expect(')');
    return (it) => {
      const v = getPath(it, path);
      if (typeof v === 'string' || Array.isArray(v)) return v.length;
      if (typeof v === 'object' && v !== null) return Object.keys(v).length;
      return undefined;
    };
  }
  const path = p.path();
  return (it) => getPath(it, path);
}

function compare(a: unknown, op: string, b: unknown): boolean {
  if (op === '=') return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
  if (op === '<>') return a === undefined || JSON.stringify(a) !== JSON.stringify(b);
  if (typeof a !== typeof b || (typeof a !== 'number' && typeof a !== 'string')) return false;
  const x = a as number | string;
  const y = b as number | string;
  switch (op) {
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '>':
      return x > y;
    case '>=':
      return x >= y;
    default:
      throw new Error(`Unknown comparator ${op}`);
  }
}

function primary(p: Parser): Cond {
  const tok = p.peek() as string;
  if (tok === '(') {
    p.next();
    const c = orExpr(p);
    p.expect(')');
    return c;
  }
  if (
    (tok === 'attribute_exists' || tok === 'attribute_not_exists' || tok === 'begins_with') &&
    p.peek(1) === '('
  ) {
    p.next();
    p.expect('(');
    const path = p.path();
    if (tok === 'begins_with') {
      p.expect(',');
      const prefix = operand(p);
      p.expect(')');
      return (it) => {
        const v = getPath(it, path);
        const pre = prefix(it);
        return typeof v === 'string' && typeof pre === 'string' && v.startsWith(pre);
      };
    }
    p.expect(')');
    return tok === 'attribute_exists'
      ? (it) => getPath(it, path) !== undefined
      : (it) => getPath(it, path) === undefined;
  }
  const left = operand(p);
  const op = p.next();
  if (!['=', '<>', '<', '<=', '>', '>='].includes(op)) throw new Error(`Bad comparator ${op}`);
  const right = operand(p);
  return (it) => compare(left(it), op, right(it));
}

function applyUpdate(item: Item, expr: string, names: Names, values: Values): Item {
  const p = new Parser(tokenise(expr), names, values);
  const out = clone(item);
  const sets: Array<[string[], Operand]> = [];
  const removes: string[][] = [];
  while (p.i < p.t.length) {
    const clause = p.next().toUpperCase();
    if (clause === 'SET') {
      do {
        if (p.peek() === ',') p.next();
        const path = p.path();
        p.expect('=');
        let value = term(p);
        if (p.peek() === '+' || p.peek() === '-') {
          const sign = p.next() === '+' ? 1 : -1;
          const a = value;
          const b = term(p);
          value = (it) => {
            const x = a(it);
            const y = b(it);
            if (typeof x !== 'number' || typeof y !== 'number') {
              throw named('ValidationException', 'Arithmetic on a non-number');
            }
            return x + sign * y;
          };
        }
        sets.push([path, value]);
      } while (p.peek() === ',');
    } else if (clause === 'REMOVE') {
      do {
        if (p.peek() === ',') p.next();
        removes.push(p.path());
      } while (p.peek() === ',');
    } else {
      throw new Error(`Unsupported update clause ${clause}`);
    }
  }
  // Right-hand sides see the item before the update, as in DynamoDB.
  const resolved = sets.map(([path, v]) => [path, v(item)] as const);
  for (const [path, v] of resolved) setPath(out, path, clone(v));
  for (const path of removes) removePath(out, path);
  return out;
}

function term(p: Parser): Operand {
  if (p.peek() === 'if_not_exists' && p.peek(1) === '(') {
    p.next();
    p.expect('(');
    const path = p.path();
    p.expect(',');
    const fallback = term(p);
    p.expect(')');
    return (it) => {
      const v = getPath(it, path);
      return v === undefined ? fallback(it) : v;
    };
  }
  return operand(p);
}

function parentOf(item: Item, path: string[]): Record<string, unknown> {
  let cur: unknown = item;
  for (const seg of path.slice(0, -1)) {
    cur = (cur as Record<string, unknown>)[seg];
    if (typeof cur !== 'object' || cur === null) {
      throw named(
        'ValidationException',
        'The document path provided in the update expression is invalid for update',
      );
    }
  }
  return cur as Record<string, unknown>;
}

function setPath(item: Item, path: string[], value: unknown) {
  parentOf(item, path)[path.at(-1) as string] = value;
}

function removePath(item: Item, path: string[]) {
  Reflect.deleteProperty(parentOf(item, path), path.at(-1) as string);
}

// ------------------------------------------------------------------ table

/** DynamoDB rejects names/values that no expression uses; so does the fake. */
function assertAllUsed(input: unknown): void {
  const parts = (input as { TransactItems?: unknown[] }).TransactItems
    ? ((input as { TransactItems: Array<Record<string, unknown>> }).TransactItems.map(
        (t) => Object.values(t)[0],
      ) as Array<Record<string, unknown>>)
    : [input as Record<string, unknown>];
  for (const p of parts) {
    const exprs = [
      p.ConditionExpression,
      p.UpdateExpression,
      p.KeyConditionExpression,
      p.FilterExpression,
      p.ProjectionExpression,
    ]
      .filter((e): e is string => typeof e === 'string')
      .join(' ');
    const used = new Set(exprs.match(/[#:][A-Za-z0-9_]+/g) ?? []);
    const provided = [
      ...Object.keys((p.ExpressionAttributeNames as object | undefined) ?? {}),
      ...Object.keys((p.ExpressionAttributeValues as object | undefined) ?? {}),
    ];
    for (const k of provided) {
      if (!used.has(k)) throw named('ValidationException', `Unused expression attribute ${k}`);
    }
  }
}

export interface FakeDynamo {
  doc: DocSender;
  items: Map<string, Item>;
  /** Command names sent, e.g. "QueryCommand". */
  log: string[];
  /** All items, for assertions. */
  all(): Item[];
}

const keyOf = (k: { pk?: unknown; sk?: unknown }) => `${String(k.pk)}|${String(k.sk)}`;

export function fakeDynamo(opts: { jitter?: boolean } = {}): FakeDynamo {
  const items = new Map<string, Item>();
  const log: string[] = [];
  const jitter = opts.jitter ?? true;

  const check = (
    existing: Item | undefined,
    cond: string | undefined,
    names: Names,
    values: Values,
  ): boolean => (cond ? parseCondition(cond, names, values)(existing ?? {}) : true);

  async function send(cmd: unknown): Promise<Record<string, unknown>> {
    if (jitter) await new Promise((r) => setTimeout(r, Math.random() * 2));
    log.push((cmd as { constructor: { name: string } }).constructor.name);
    assertAllUsed((cmd as { input: unknown }).input);

    if (cmd instanceof GetCommand) {
      const found = items.get(keyOf(cmd.input.Key as Item));
      return found ? { Item: clone(found) } : {};
    }
    if (cmd instanceof PutCommand) {
      const it = cmd.input.Item as Item;
      const k = keyOf(it);
      const {
        ConditionExpression: c,
        ExpressionAttributeNames: n,
        ExpressionAttributeValues: v,
      } = cmd.input;
      if (!check(items.get(k), c, n, v)) throw named('ConditionalCheckFailedException');
      items.set(k, clone(it));
      return {};
    }
    if (cmd instanceof UpdateCommand) {
      const key = cmd.input.Key as Item;
      const k = keyOf(key);
      const {
        ConditionExpression: c,
        ExpressionAttributeNames: n,
        ExpressionAttributeValues: v,
      } = cmd.input;
      const existing = items.get(k);
      if (!check(existing, c, n, v)) throw named('ConditionalCheckFailedException');
      const updated = applyUpdate(
        existing ?? { ...key },
        cmd.input.UpdateExpression as string,
        n,
        v,
      );
      items.set(k, updated);
      return { Attributes: clone(updated) };
    }
    if (cmd instanceof DeleteCommand) {
      const k = keyOf(cmd.input.Key as Item);
      const {
        ConditionExpression: c,
        ExpressionAttributeNames: n,
        ExpressionAttributeValues: v,
      } = cmd.input;
      if (!check(items.get(k), c, n, v)) throw named('ConditionalCheckFailedException');
      items.delete(k);
      return {};
    }
    if (cmd instanceof QueryCommand) {
      const input = cmd.input;
      const idx = input.IndexName ? INDEXES[input.IndexName] : { pk: 'pk', sk: 'sk' };
      if (!idx) throw named('ValidationException', `Unknown index ${input.IndexName}`);
      if (input.IndexName && input.ConsistentRead) {
        throw named('ValidationException', 'Consistent reads are not supported on GSIs');
      }
      const keyCond = parseCondition(
        input.KeyConditionExpression as string,
        input.ExpressionAttributeNames,
        input.ExpressionAttributeValues,
      );
      let rows = [...items.values()]
        .filter((it) => typeof it[idx.pk] === 'string' && typeof it[idx.sk] === 'string')
        .filter(keyCond)
        .sort((a, b) => {
          const x = `${String(a[idx.sk])}\u0000${keyOf(a)}`;
          const y = `${String(b[idx.sk])}\u0000${keyOf(b)}`;
          return x < y ? -1 : x > y ? 1 : 0;
        });
      if (input.ScanIndexForward === false) rows.reverse();
      if (input.ExclusiveStartKey) {
        const start = keyOf(input.ExclusiveStartKey as Item);
        const at = rows.findIndex((r) => keyOf(r) === start);
        rows = at === -1 ? [] : rows.slice(at + 1);
      }
      let last: Item | undefined;
      if (input.Limit && rows.length > input.Limit) {
        rows = rows.slice(0, input.Limit);
        const tail = rows.at(-1) as Item;
        last = { pk: tail.pk, sk: tail.sk };
        if (input.IndexName)
          Object.assign(last, { [idx.pk]: tail[idx.pk], [idx.sk]: tail[idx.sk] });
      }
      if (input.Select === 'COUNT') return { Count: rows.length, LastEvaluatedKey: last };
      return { Items: rows.map(clone), Count: rows.length, LastEvaluatedKey: last };
    }
    if (cmd instanceof BatchWriteCommand) {
      const all = Object.values(cmd.input.RequestItems ?? {}).flat() as Array<{
        PutRequest?: { Item: Item };
        DeleteRequest?: { Key: Item };
      }>;
      if (all.length > 25) throw named('ValidationException', 'Too many items in BatchWrite');
      for (const r of all) {
        if (r.PutRequest) items.set(keyOf(r.PutRequest.Item), clone(r.PutRequest.Item));
        if (r.DeleteRequest) items.delete(keyOf(r.DeleteRequest.Key));
      }
      return { UnprocessedItems: {} };
    }
    if (cmd instanceof TransactWriteCommand) {
      const ops = cmd.input.TransactItems ?? [];
      if (ops.length > 100) throw named('ValidationException', 'Too many transaction items');
      const seen = new Set<string>();
      const plan = ops.map((op) => {
        const o = (op.Put ?? op.Update ?? op.Delete ?? op.ConditionCheck) as {
          Item?: Item;
          Key?: Item;
          ConditionExpression?: string;
          ExpressionAttributeNames?: Names;
          ExpressionAttributeValues?: Values;
          UpdateExpression?: string;
        };
        const k = keyOf((o.Item ?? o.Key) as Item);
        if (seen.has(k)) {
          throw named(
            'ValidationException',
            'Transaction request cannot include multiple operations on one item',
          );
        }
        seen.add(k);
        return { op, o, k };
      });
      const failed = plan.map(
        ({ o, k }) =>
          !check(
            items.get(k),
            o.ConditionExpression,
            o.ExpressionAttributeNames,
            o.ExpressionAttributeValues,
          ),
      );
      if (failed.some(Boolean)) {
        throw named('TransactionCanceledException', 'Transaction cancelled', {
          CancellationReasons: failed.map((f) => ({ Code: f ? 'ConditionalCheckFailed' : 'None' })),
        });
      }
      for (const { op, o, k } of plan) {
        if (op.Put) items.set(k, clone(o.Item as Item));
        else if (op.Delete) items.delete(k);
        else if (op.Update) {
          items.set(
            k,
            applyUpdate(
              items.get(k) ?? { ...(o.Key as Item) },
              o.UpdateExpression as string,
              o.ExpressionAttributeNames,
              o.ExpressionAttributeValues,
            ),
          );
        }
      }
      return {};
    }
    throw new Error(`Unsupported command ${(cmd as object).constructor.name}`);
  }

  return {
    doc: { send } as DocSender,
    items,
    log,
    all: () => [...items.values()].map(clone),
  };
}
