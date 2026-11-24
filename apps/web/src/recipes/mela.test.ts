import { existsSync, readFileSync } from 'node:fs';
import { RECIPE_LIMITS, parseRecipeInput } from '@trolley/core';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  isDuplicate,
  melaSourceId,
  melaTime,
  melaYield,
  mapMelaRecipe,
  parseMelaBytes,
  parseMelaJson,
  sniffImageType,
  readMelaRecipe,
  runMelaImport,
  type ImportDeps,
  type MelaRecipe,
} from './mela';

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const one = (n: string): MelaRecipe => {
  const r = parseMelaJson(n, fx(n));
  expect(r.problems).toEqual([]);
  return r.recipes[0] as MelaRecipe;
};

describe('Mela parsing and mapping', () => {
  it('maps a full .melarecipe and passes server validation', () => {
    const m = one('lemon-pasta.melarecipe');
    expect(m).toMatchObject({
      id: 'fixture-lemon-pasta',
      favourite: true,
      categories: ['Dinner', 'Quick'],
    });
    expect(m.image).toMatch(/^iVBOR/);
    const { input, truncated } = mapMelaRecipe(m);
    expect(truncated).toEqual([]);
    expect(input).toMatchObject({
      title: 'Fixture lemon pasta',
      description: 'A made-up test recipe.',
      yield: 'Serves 2',
      sourceUrl: 'https://example.com/fixture-lemon-pasta',
      favourite: true,
      source: { app: 'mela', id: 'fixture-lemon-pasta' },
    });
    expect(input.ingredients).toContain('# Pasta');
    const parsed = parseRecipeInput(input, 'hh');
    expect(parsed.ok).toBe(true);
  });

  it('tolerates numbers for strings, comma categories, string booleans and bad links', () => {
    const { input } = mapMelaRecipe(one('messy-toast.melarecipe'));
    expect(input).toMatchObject({
      prepTime: '5 min',
      cookTime: '3 min',
      yield: 'Serves 2',
      categories: ['Breakfast', 'Quick'],
      favourite: true,
      sourceUrl: '',
    });
  });

  it('tolerates missing fields, extras and non-recipes', () => {
    expect(readMelaRecipe({ title: 'Just a title', mystery: [1, 2] })).toMatchObject({
      title: 'Just a title',
      ingredients: '',
      image: null,
      favourite: false,
      categories: [],
    });
    expect(readMelaRecipe({ images: ['  '], id: 42 })).toBeNull();
    expect(readMelaRecipe('nope')).toBeNull();
    expect(parseMelaJson('bad.melarecipe', strToU8('{not json')).problems).toHaveLength(1);
  });

  it('strips a data: prefix from images', () => {
    expect(readMelaRecipe({ title: 'x', images: ['data:image/png;base64,AAAA'] })?.image).toBe(
      'AAAA',
    );
  });

  it('reads a .melarecipes zip, ignoring __MACOSX junk and non-recipe entries', async () => {
    const r = await parseMelaBytes('two-recipes.melarecipes', fx('two-recipes.melarecipes'));
    expect(r.problems).toEqual([]);
    expect(r.recipes.map((x) => x.title)).toEqual(['Fixture lemon pasta', 'Lamb curry']);
    const odd = zipSync({ 'readme.txt': strToU8('hi') });
    expect((await parseMelaBytes('x.melarecipes', odd)).problems[0]).toMatch(/no Mela recipes/);
    expect(
      (await parseMelaBytes('x.melarecipes', new Uint8Array([0x50, 0x4b, 1, 2, 3]))).problems,
    ).toHaveLength(1);
  });

  it('truncates over-limit fields with a note', () => {
    const m: MelaRecipe = {
      ...one('lemon-pasta.melarecipe'),
      title: 'T'.repeat(200),
      notes: 'n'.repeat(RECIPE_LIMITS.notes + 10),
      ingredients: Array.from({ length: 250 }, (_, i) => `item ${i}`).join('\n'),
      categories: Array.from({ length: 14 }, (_, i) => `cat${i}`),
    };
    const { input, truncated } = mapMelaRecipe(m);
    expect(truncated.sort()).toEqual(['categories', 'ingredients', 'notes', 'title']);
    expect(input.title).toHaveLength(RECIPE_LIMITS.title);
    expect(input.categories).toHaveLength(RECIPE_LIMITS.categories);
    expect(parseRecipeInput(input, 'hh').ok).toBe(true);
  });

  it('flags duplicates by Mela id, then exact title and link', () => {
    const pasta = one('lemon-pasta.melarecipe');
    const curry = one('lamb-curry.melarecipe');
    const known = [
      {
        title: 'Renamed',
        sourceUrl: '',
        source: { app: 'mela' as const, id: 'fixture-lemon-pasta' },
      },
      {
        title: 'LAMB  curry',
        sourceUrl: 'https://www.example.com/recipes/lamb-curry',
        source: null,
      },
    ];
    expect(isDuplicate(pasta, known)).toBe(true);
    expect(isDuplicate(curry, known)).toBe(true);
    expect(isDuplicate(curry, [{ ...known[1]!, sourceUrl: 'https://other.example.com' }])).toBe(
      false,
    );
    expect(isDuplicate(one('messy-toast.melarecipe'), known)).toBe(false);
  });
});

describe('runMelaImport', () => {
  const recipes = [
    one('lemon-pasta.melarecipe'),
    one('messy-toast.melarecipe'),
    one('lamb-curry.melarecipe'),
  ];
  const deps = (over: Partial<ImportDeps> = {}): ImportDeps => ({
    uploadPhoto: vi.fn(async () => 'recipes/hh/photo.jpg'),
    create: vi.fn(async () => ({ id: 'r' })),
    describeError: (e) => ({ reason: String(e), limit: false }),
    ...over,
  });

  it('imports in order, uploading the photo first, and reports progress', async () => {
    const d = deps();
    const progress: number[] = [];
    const s = await runMelaImport(d, {
      recipes,
      existingCount: 0,
      skippedDuplicates: 2,
      onProgress: (n) => progress.push(n),
    });
    expect(s).toMatchObject({ imported: 3, failed: 0, skippedDuplicates: 2, cancelled: false });
    expect(d.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.create).mock.calls[0]?.[0].photoKey).toBe('recipes/hh/photo.jpg');
    expect(progress).toEqual([0, 1, 2, 3]);
  });

  it('keeps going when a photo or a recipe fails, and reports reasons', async () => {
    const d = deps({
      uploadPhoto: vi.fn(async () => {
        throw new Error('bad image');
      }),
      create: vi.fn(async (i) => {
        if (i.title === 'Fixture toast') throw new Error('boom');
        return { id: 'r' };
      }),
    });
    const s = await runMelaImport(d, { recipes, existingCount: 0, skippedDuplicates: 0 });
    expect(s.imported).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.outcomes).toEqual([
      { status: 'imported', title: 'Fixture lemon pasta', notes: ["Photo couldn't be read"] },
      { status: 'failed', title: 'Fixture toast', reason: 'Error: boom' },
    ]);
  });

  it('stops at the household limit without calling create', async () => {
    const d = deps();
    const s = await runMelaImport(d, {
      recipes,
      existingCount: RECIPE_LIMITS.recipes - 1,
      skippedDuplicates: 0,
    });
    expect(s.imported).toBe(1);
    expect(s.failed).toBe(2);
    expect(d.create).toHaveBeenCalledTimes(1);
    expect(s.outcomes[0]).toMatchObject({ reason: 'Recipe limit reached (500)' });
  });

  it('can be cancelled between recipes', async () => {
    const ctl = new AbortController();
    const d = deps({
      create: vi.fn(async () => {
        ctl.abort();
        return { id: 'r' };
      }),
    });
    const s = await runMelaImport(d, {
      recipes,
      existingCount: 0,
      skippedDuplicates: 0,
      signal: ctl.signal,
    });
    expect(s).toMatchObject({ imported: 1, cancelled: true });
  });
});

describe('Mela value formats', () => {
  it('formats bare minutes, yields and nutrition bold', () => {
    expect(melaTime('15')).toBe('15 min');
    expect(melaTime('65')).toBe('1 hr 5 min');
    expect(melaTime('120')).toBe('2 hr');
    expect(melaTime('1 hour')).toBe('1 hr');
    expect(melaYield('10')).toBe('Serves 10');
    expect(melaYield('2 loaves')).toBe('2 loaves');
    expect(melaYield('SERVES: 5')).toBe('Serves 5');
    expect(melaYield('4 - 6 people')).toBe('4 - 6 people');
    expect(melaYield('')).toBe('');
    const times: [string, string][] = [
      ['', ''],
      ['10', '10 min'],
      ['10min', '10 min'],
      ['10 MINUTES', '10 min'],
      ['1h', '1 hr'],
      ['10h', '10 hr'],
      ['2h25min', '2 hr 25 min'],
      ['1 hour 5 minutes', '1 hr 5 min'],
      ['overnight', 'overnight'],
    ];
    for (const [i, o] of times) expect(melaTime(i), i).toBe(o);
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(
      sniffImageType(
        new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0]),
      ),
    ).toBe('image/heic');
    const r = readMelaRecipe({ title: 'x', nutrition: '**Calories** 71 calories\n**Fat** 2 g' });
    expect(r?.nutrition).toBe('Calories 71 calories\nFat 2 g');
  });

  it('hashes very long ids to something storable', () => {
    const long = readMelaRecipe({
      title: 'x',
      id: `taste.com.au/${'a'.repeat(300)}?utm=1`,
    }) as MelaRecipe;
    const id = melaSourceId(long);
    expect(id.length).toBeLessThan(60);
    expect(melaSourceId(long)).toBe(id);
    expect(melaSourceId({ ...long, id: long.id + 'b' })).not.toBe(id);
  });
});

const REAL =
  '/root/.claude/uploads/8e252ed6-4540-5359-9d43-d654ea5e1540/2da9fcaf-Aussie-style_beef_and_salad_tacos_recipe.melarecipe';
describe.skipIf(!existsSync(REAL))('a real Mela export (local only)', () => {
  it('parses, maps and validates', async () => {
    const r = await parseMelaBytes('real.melarecipe', new Uint8Array(readFileSync(REAL)));
    expect(r.problems).toEqual([]);
    const m = r.recipes[0] as MelaRecipe;
    expect(m.image).toMatch(/^\/9j\//);
    const { input, truncated } = mapMelaRecipe(m);
    expect(truncated).toEqual([]);
    expect(input).toMatchObject({
      prepTime: '15 min',
      cookTime: '20 min',
      totalTime: '35 min',
      yield: 'Serves 10',
    });
    expect(input.nutrition).not.toContain('*');
    expect(input.sourceUrl).toMatch(/^https:\/\/www\.taste\.com\.au\//);
    expect(parseRecipeInput(input, 'hh').ok).toBe(true);
  });
});

const FULL =
  '/root/.claude/uploads/8e252ed6-4540-5359-9d43-d654ea5e1540/6b70e5e9-Recipes.melarecipes';
describe.skipIf(!existsSync(FULL))('a real full Mela export (local only)', () => {
  it('reads the ZIP64 zip, keeps headings, tolerates absent fields and HEIC images', async () => {
    const r = await parseMelaBytes('Recipes.melarecipes', new Uint8Array(readFileSync(FULL)));
    expect(r.problems).toEqual([]);
    expect(r.recipes.length).toBeGreaterThan(30);
    let headings = 0;
    const types = new Set<string>();
    for (const m of r.recipes) {
      const { input } = mapMelaRecipe(m);
      expect(parseRecipeInput(input, 'hh').ok, m.title).toBe(true);
      expect(input.yield).not.toMatch(/^\d+$|^serves:/i);
      headings += (input.ingredients ?? '').split('\n').filter((l) => l.startsWith('#')).length;
      if (m.image)
        types.add(
          sniffImageType(
            Uint8Array.from(atob(m.image.slice(0, 64).padEnd(64, 'A')), (c) => c.charCodeAt(0)),
          ),
        );
    }
    expect(headings).toBeGreaterThan(30);
    expect(types.has('image/jpeg')).toBe(true);
    expect(types.has('image/heic')).toBe(true);
  });
});
