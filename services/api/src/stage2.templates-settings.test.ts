import type {
  AisleOrderResponse,
  GroupsResponse,
  ProductDetailResponse,
  ProductSearchResponse,
  Template,
  TemplateItemMutationResponse,
  TemplatesResponse,
  UnitOverrideResponse,
  UnitOverridesResponse,
} from '@trolley/core';
import { DEFAULT_AISLE_ORDER } from '@trolley/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { BANANAS, BREAD, MILK, MINCE, setup, type Harness } from './test/harness';

let h: Harness;
beforeEach(() => {
  h = setup();
});

async function createTemplate(name: string, type?: string) {
  const res = await h.call<Template>('POST /api/templates', {
    body: { name, ...(type ? { type } : {}) },
  });
  expect(res.status).toBe(201);
  return res.body;
}

const addTo = (templateId: string, body: Record<string, unknown>) =>
  h.call<TemplateItemMutationResponse>('POST /api/templates/{templateId}/items', {
    path: { templateId },
    body,
  });

describe('templates (B1-B4)', () => {
  it('creates, lists weekly first then by name, with counts and previews', async () => {
    const tacos = await createTemplate('Tacos', 'meal');
    const weekly = await createTemplate('Weekly basics');
    await createTemplate('Another weekly', 'weekly');
    expect(weekly).toMatchObject({ type: 'weekly', itemCount: 0, items: [], version: 1 });
    await addTo(tacos.id, { productId: MINCE, qty: 1, unit: 'pack' });
    await addTo(tacos.id, { productId: BANANAS, qty: 1, unit: 'kg' });
    const res = await h.call<TemplatesResponse>('GET /api/templates');
    expect(res.body.templates.map((t) => [t.name, t.type, t.itemCount])).toEqual([
      ['Another weekly', 'weekly', 0],
      ['Weekly basics', 'weekly', 0],
      ['Tacos', 'meal', 2],
    ]);
    // Preview in aisle order: Fruit & Veg before Meat.
    expect(res.body.templates[2]?.preview).toEqual(['Cavendish Bananas', 'Beef Mince 500g']);
  });

  it('renames and changes type with a version check; deletes', async () => {
    const t = await createTemplate('Weekly');
    const ok = await h.call<Template>('PATCH /api/templates/{templateId}', {
      path: { templateId: t.id },
      body: { name: 'Weekly basics', type: 'meal', version: 1 },
    });
    expect(ok.body).toMatchObject({ name: 'Weekly basics', type: 'meal', version: 2 });
    const stale = await h.call('PATCH /api/templates/{templateId}', {
      path: { templateId: t.id },
      body: { name: 'Old', version: 1 },
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { reason: 'STALE', current: { version: 2 } },
    });
    expect(
      (
        await h.call('PATCH /api/templates/{templateId}', {
          path: { templateId: t.id },
          body: { type: 'daily', version: 2 },
        })
      ).body,
    ).toMatchObject({ field: 'type' });
    expect(
      (await h.call('DELETE /api/templates/{templateId}', { path: { templateId: t.id } })).status,
    ).toBe(204);
    expect(
      (await h.call('GET /api/templates/{templateId}', { path: { templateId: t.id } })).status,
    ).toBe(404);
    expect(
      (await h.call('DELETE /api/templates/{templateId}', { path: { templateId: t.id } })).status,
    ).toBe(404);
  });

  it('adds items by the merge rule and sorts them by aisle order then name (B3, B4)', async () => {
    const t = await createTemplate('Weekly');
    const a = await addTo(t.id, { productId: MILK, qty: 2, unit: 'pack' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ merged: false, item: { qty: 2, version: 1 } });
    const b = await addTo(t.id, { productId: MILK, qty: 1, unit: 'pack', note: 'blue top' });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ merged: true, item: { qty: 3, note: 'blue top', version: 2 } });
    await addTo(t.id, { productId: MILK, qty: 2, unit: 'L' });
    await addTo(t.id, { productId: BANANAS, qty: 1, unit: 'kg' });
    await addTo(t.id, { productId: BREAD, qty: 1, unit: 'each' });
    const got = await h.call<Template>('GET /api/templates/{templateId}', {
      path: { templateId: t.id },
    });
    expect(got.body.items.map((i) => i.id)).toEqual([
      `${BANANAS}~kg`,
      `${BREAD}~each`,
      `${MILK}~L`,
      `${MILK}~pack`,
    ]);
    expect(got.body.itemCount).toBe(4);
  });

  it('edits items with an item version, re-keys on unit change, and deletes items', async () => {
    const t = await createTemplate('Weekly');
    await addTo(t.id, { productId: BANANAS, qty: 1, unit: 'kg' });
    const edit = await h.call<TemplateItemMutationResponse>(
      'PATCH /api/templates/{templateId}/items/{itemId}',
      {
        path: { templateId: t.id, itemId: `${BANANAS}~kg` },
        body: { qty: 1.25, note: 'ripe', version: 1 },
      },
    );
    expect(edit.body.item).toMatchObject({ qty: 1.25, note: 'ripe', version: 2 });
    const stale = await h.call('PATCH /api/templates/{templateId}/items/{itemId}', {
      path: { templateId: t.id, itemId: `${BANANAS}~kg` },
      body: { qty: 2, version: 1 },
    });
    expect(stale).toMatchObject({ status: 409, body: { reason: 'STALE' } });
    const unit = await h.call<TemplateItemMutationResponse>(
      'PATCH /api/templates/{templateId}/items/{itemId}',
      {
        path: { templateId: t.id, itemId: `${BANANAS}~kg` },
        body: { unit: 'each', qty: 6, version: 2 },
      },
    );
    expect(unit.body.item).toMatchObject({ id: `${BANANAS}~each`, qty: 6, note: 'ripe' });
    const ticked = await h.call('PATCH /api/templates/{templateId}/items/{itemId}', {
      path: { templateId: t.id, itemId: `${BANANAS}~each` },
      body: { ticked: true },
    });
    expect(ticked.body).toMatchObject({ field: 'ticked' });
    const del = await h.call<{ template: Template }>(
      'DELETE /api/templates/{templateId}/items/{itemId}',
      {
        path: { templateId: t.id, itemId: `${BANANAS}~each` },
      },
    );
    expect(del.body.template.items).toHaveLength(0);
    expect(
      (
        await h.call('DELETE /api/templates/{templateId}/items/{itemId}', {
          path: { templateId: t.id, itemId: `${BANANAS}~each` },
        })
      ).status,
    ).toBe(404);
  });

  it('two phones adding to one template at once keep both adds', async () => {
    const t = await createTemplate('Weekly');
    await Promise.all([
      addTo(t.id, { productId: MILK, qty: 1, unit: 'pack' }),
      addTo(t.id, { productId: BREAD, qty: 1, unit: 'each' }),
      addTo(t.id, { productId: MILK, qty: 2, unit: 'pack' }),
    ]);
    const got = await h.call<Template>('GET /api/templates/{templateId}', {
      path: { templateId: t.id },
    });
    expect(got.body.items.map((i) => [i.id, i.qty])).toEqual([
      [`${BREAD}~each`, 1],
      [`${MILK}~pack`, 3],
    ]);
  });

  it('limits templates to 50 and items to 100 (409)', async () => {
    const t = await createTemplate('Big');
    for (let i = 0; i < 100; i += 1) {
      expect(
        (await addTo(t.id, { productId: String(800000 + i), qty: 1, unit: 'each' })).status,
      ).toBe(201);
    }
    const full = await addTo(t.id, { productId: '800100', qty: 1, unit: 'each' });
    expect(full).toMatchObject({ status: 409, body: { reason: 'LIMIT' } });
    expect(String((full.body as unknown as { message: string }).message)).toContain('100 items');
    for (let i = 1; i < 50; i += 1) await createTemplate(`T${i}`);
    expect(
      (await h.call('POST /api/templates', { body: { name: 'One more' } })).body,
    ).toMatchObject({
      reason: 'LIMIT',
    });
  });

  it('validates names (A2)', async () => {
    expect((await h.call('POST /api/templates', { body: { name: '' } })).body).toMatchObject({
      field: 'name',
      message: 'Enter a name for this template.',
    });
    expect(
      (await h.call('POST /api/templates', { body: { name: 'x'.repeat(61) } })).body,
    ).toMatchObject({
      field: 'name',
    });
  });
});

describe('settings: aisle order (G1)', () => {
  it('defaults to the ALDI order; saves, versions, resets; GET /api/groups follows it', async () => {
    const initial = await h.call<AisleOrderResponse>('GET /api/settings/aisle-order');
    expect(initial.body).toMatchObject({ isDefault: true, version: 0 });
    expect(initial.body.groups.map((g) => g.id)).toEqual(DEFAULT_AISLE_ORDER);

    const order = ['frozen', ...DEFAULT_AISLE_ORDER.filter((g) => g !== 'frozen')];
    const saved = await h.call<AisleOrderResponse>('PUT /api/settings/aisle-order', {
      body: { order, version: 0 },
    });
    expect(saved.body).toMatchObject({ isDefault: false, version: 1 });
    expect(saved.body.groups[0]).toEqual({ id: 'frozen', name: 'Frozen', shortName: 'Frozen' });
    const groups = await h.call<GroupsResponse>('GET /api/groups');
    expect(groups.body.groups[0]?.id).toBe('frozen');

    const stale = await h.call('PUT /api/settings/aisle-order', { body: { order, version: 0 } });
    expect(stale).toMatchObject({
      status: 409,
      body: { reason: 'STALE', current: { version: 1 } },
    });
    const unchecked = await h.call<AisleOrderResponse>('PUT /api/settings/aisle-order', {
      body: { order: [...order].reverse() },
    });
    expect(unchecked.body.version).toBe(2);

    const reset = await h.call<AisleOrderResponse>('DELETE /api/settings/aisle-order');
    expect(reset.body).toMatchObject({ isDefault: true, version: 3 });
    expect((await h.call<GroupsResponse>('GET /api/groups')).body.groups[0]?.id).toBe('fruit-veg');
  });

  it('rejects anything but a permutation of the 15 groups', async () => {
    const res = await h.call('PUT /api/settings/aisle-order', {
      body: { order: DEFAULT_AISLE_ORDER.slice(1) },
    });
    expect(res).toMatchObject({ status: 400, body: { field: 'order' } });
  });
});

describe('settings: unit overrides (C5, G2)', () => {
  it('remembers a unit for search, detail and both phones; lists and removes it', async () => {
    const put = await h.call<UnitOverrideResponse>('PUT /api/settings/unit-overrides/{productId}', {
      path: { productId: MILK },
      body: { unit: 'L' },
    });
    expect(put.body.override).toMatchObject({
      productId: MILK,
      unit: 'L',
      defaultUnit: 'pack',
      name: 'Full Cream Milk 2L',
      packSize: '2 L',
    });
    // The other phone (another user in the household) sees it.
    const search = await h.call<ProductSearchResponse>('GET /api/products/search', {
      query: { q: 'milk' },
      user: 'user-2',
    });
    expect(search.body.items.find((p) => p.sku === MILK)).toMatchObject({
      unitType: 'L',
      defaultUnitType: 'pack',
    });
    const detail = await h.call<ProductDetailResponse>('GET /api/products/{sku}', {
      path: { sku: MILK },
    });
    expect(detail.body).toMatchObject({ unitType: 'L', defaultUnitType: 'pack' });

    await h.call('PUT /api/settings/unit-overrides/{productId}', {
      path: { productId: BANANAS },
      body: { unit: 'each' },
    });
    const list = await h.call<UnitOverridesResponse>('GET /api/settings/unit-overrides');
    expect(list.body.overrides.map((o) => o.name)).toEqual([
      'Cavendish Bananas',
      'Full Cream Milk 2L',
    ]);

    expect(
      (
        await h.call('DELETE /api/settings/unit-overrides/{productId}', {
          path: { productId: MILK },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await h.call('DELETE /api/settings/unit-overrides/{productId}', {
          path: { productId: MILK },
        })
      ).status,
    ).toBe(404);
    const after = await h.call<ProductDetailResponse>('GET /api/products/{sku}', {
      path: { sku: MILK },
    });
    expect(after.body.unitType).toBe('pack');
  });

  it('choosing the default unit removes the override', async () => {
    await h.call('PUT /api/settings/unit-overrides/{productId}', {
      path: { productId: MILK },
      body: { unit: 'L' },
    });
    const res = await h.call<UnitOverrideResponse>('PUT /api/settings/unit-overrides/{productId}', {
      path: { productId: MILK },
      body: { unit: 'pack' },
    });
    expect(res.body.override).toBeNull();
    expect(
      (await h.call<UnitOverridesResponse>('GET /api/settings/unit-overrides')).body.overrides,
    ).toEqual([]);
  });

  it('validates unit and product', async () => {
    expect(
      (
        await h.call('PUT /api/settings/unit-overrides/{productId}', {
          path: { productId: MILK },
          body: { unit: 'lb' },
        })
      ).body,
    ).toMatchObject({ field: 'unit' });
    expect(
      (
        await h.call('PUT /api/settings/unit-overrides/{productId}', {
          path: { productId: '424242' },
          body: { unit: 'L' },
        })
      ).status,
    ).toBe(404);
  });

  it('keeps an aisle reorder and a unit override from overwriting each other', async () => {
    const order = [...DEFAULT_AISLE_ORDER].reverse();
    await Promise.all([
      h.call('PUT /api/settings/aisle-order', { body: { order } }),
      h.call('PUT /api/settings/unit-overrides/{productId}', {
        path: { productId: MILK },
        body: { unit: 'L' },
      }),
      h.call('PUT /api/settings/unit-overrides/{productId}', {
        path: { productId: BANANAS },
        body: { unit: 'g' },
      }),
    ]);
    expect((await h.call<AisleOrderResponse>('GET /api/settings/aisle-order')).body.isDefault).toBe(
      false,
    );
    expect(
      (await h.call<UnitOverridesResponse>('GET /api/settings/unit-overrides')).body.overrides,
    ).toHaveLength(2);
  });
});
