import { describe, expect, it } from 'vitest';
import { AldiClient } from '../src/aldi-client';
import { fixtureFetch } from '../src/fixture-fetch';
import { runScrape } from '../src/run';

describe('--fixtures dry run', () => {
  it('crawls the recorded fixtures offline, completely and without unmapped products', async () => {
    const client = new AldiClient({ fetchImpl: fixtureFetch(), minIntervalMs: 0 });
    const { run, products } = await runScrape({ client, servicePoint: 'G526' });
    expect(run.status).toBe('succeeded');
    expect(products.length).toBe(run.expectedTotal);
    expect(products.length).toBeGreaterThan(50);
    expect(run.unmappedCategories).toEqual({});
    expect(run.unitTypes.kg).toBeGreaterThan(0);
    expect(run.unitTypes.each).toBeGreaterThan(0);
    expect(run.unitTypes.pack).toBeGreaterThan(0);
  });
});
