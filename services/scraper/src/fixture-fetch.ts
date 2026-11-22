/**
 * Offline stand-in for api.aldi.com.au built from the recorded fixtures in
 * test/fixtures (CLI `--fixtures`). Never used by the Lambda.
 */
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { AldiCategoryNode, AldiProduct } from './aldi-types';

export const FIXTURES_DIR = path.resolve(__dirname, '..', 'test', 'fixtures');

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

export function fixtureFetch(dir = FIXTURES_DIR): typeof fetch {
  const read = (name: string): unknown => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
  const tree = (read('category-tree.json') as { data: AldiCategoryNode[] }).data;
  const bySku = new Map<string, AldiProduct>();
  for (const file of readdirSync(dir).filter(
    (f) => f.startsWith('search-') && f.endsWith('.json'),
  )) {
    for (const p of (read(file) as { data: AldiProduct[] }).data) bySku.set(p.sku, p);
  }
  const products = [...bySku.values()];

  return async (input) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.pathname === '/v2/product-category-tree') return jsonResponse({ data: tree });
    if (url.pathname === '/v3/product-search') {
      const key = url.searchParams.get('categoryKey');
      const limit = Number(url.searchParams.get('limit') ?? 12);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const all = key ? products.filter((p) => p.categories?.some((c) => c.id === key)) : products;
      return jsonResponse({
        meta: { pagination: { offset, limit, totalCount: all.length } },
        data: all.slice(offset, offset + limit),
      });
    }
    return new Response('{"errors":[]}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
}
