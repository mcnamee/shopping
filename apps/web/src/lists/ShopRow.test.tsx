// @vitest-environment jsdom
import type { ListItem } from '@trolley/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShopRow } from './ShopRow';

const NOTE =
  'Get the lactose free one in the green carton, not the blue, and check the date is at least a week away';

const item = (over: Partial<ListItem> = {}): ListItem =>
  ({
    id: 'p~each',
    qty: 1,
    unit: 'each',
    ticked: false,
    tickedAt: null,
    note: NOTE,
    version: 1,
    product: { productId: 'p', name: 'Milk', packSize: null, imageUrl: null, groupId: 'dairy' },
    ...over,
  }) as unknown as ListItem;

describe('ShopRow', () => {
  it('shows a long note in full and wraps it (B-012)', () => {
    render(
      <ul>
        <ShopRow item={item()} />
      </ul>,
    );
    const note = screen.getByText(NOTE);
    expect(note).toBeVisible();
    expect(note.className).not.toMatch(/truncate|line-clamp/);
    expect(note.className).toMatch(/whitespace-normal/);
  });

  it('marks a tick that is waiting to sync', () => {
    const { rerender } = render(
      <ul>
        <ShopRow item={item({ note: null })} />
      </ul>,
    );
    expect(screen.queryByTestId('pending-sync')).toBeNull();
    rerender(
      <ul>
        <ShopRow item={item({ note: null })} pending />
      </ul>,
    );
    expect(screen.getByTestId('pending-sync')).toHaveTextContent('Waiting to sync');
  });
});

describe('ShopRow free-text line', () => {
  const text = (over: Partial<ListItem> = {}) =>
    item({
      kind: 'text',
      id: 'TEXT~0123456789abcdef',
      note: 'From Lamb curry',
      product: {
        productId: 'TEXT~0123456789abcdef',
        name: '2 cups plain flour',
        packSize: null,
        imageUrl: null,
        groupId: 'pantry',
      } as ListItem['product'],
      ...over,
    });

  it('shows the text, the recipe note and an icon, with no quantity', () => {
    render(
      <ul>
        <ShopRow item={text()} />
      </ul>,
    );
    const box = screen.getByRole('checkbox', { name: '2 cups plain flour' });
    expect(box).toHaveTextContent('From Lamb curry');
    expect(box).not.toHaveTextContent(/\b1\b/);
    expect(screen.getByTestId('text-line-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('image-fallback')).not.toBeInTheDocument();
  });

  it('is static in the archived view', () => {
    render(
      <ul>
        <ShopRow item={text({ ticked: true })} readOnly />
      </ul>,
    );
    expect(screen.getByText('2 cups plain flour')).toBeInTheDocument();
    expect(screen.queryByText(/^1$/)).not.toBeInTheDocument();
    expect(screen.getByText('From Lamb curry')).toBeInTheDocument();
  });
});
