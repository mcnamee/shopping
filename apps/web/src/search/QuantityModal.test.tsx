// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductSummary } from '@trolley/core';
import { describe, expect, it, vi } from 'vitest';
import { QuantityModal } from './QuantityModal';

const product = (over: Partial<ProductSummary> = {}): ProductSummary => ({
  sku: '1',
  name: 'Potatoes',
  brand: 'Farm Fresh',
  imageUrl: null,
  price: 399,
  unitPrice: null,
  packSize: 'per kg',
  unitType: 'kg',
  groupId: 'fruit-veg',
  custom: false,
  ...over,
});

function setup(p: ProductSummary = product()) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<QuantityModal product={p} onConfirm={onConfirm} onClose={onClose} />);
  const field = () => screen.getByRole('textbox', { name: /^Quantity/ });
  return { user, onConfirm, onClose, field };
}

describe('QuantityModal', () => {
  it('is a labelled modal dialog with initial focus on the product name', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', { name: 'Potatoes' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Potatoes' })).toHaveFocus();
    expect(screen.getByText('per kg · Farm Fresh')).toBeInTheDocument();
  });

  it('opens at the unit default and steps kg by 0.25 without float noise', async () => {
    const { user, field } = setup();
    await screen.findByRole('dialog');
    expect(field()).toHaveValue('1');
    const inc = screen.getByRole('button', { name: 'Increase quantity' });
    await user.click(inc);
    await user.click(inc);
    await user.click(inc);
    expect(field()).toHaveValue('1.75');
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(field()).toHaveValue('1.5');
    expect(screen.getByRole('status')).toHaveTextContent('Quantity 1.5 kilograms');
  });

  it('shows presets for the unit, marks the current one and sets on tap', async () => {
    const { user, field } = setup();
    await screen.findByRole('dialog');
    const group = screen.getByRole('group', { name: 'Quick amounts' });
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      '0.5 kg',
      '1 kg',
      '1.5 kg',
      '2 kg',
    ]);
    expect(screen.getByRole('button', { name: '1 kg' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '1.5 kg' }));
    expect(field()).toHaveValue('1.5');
    expect(screen.getByRole('button', { name: '1.5 kg' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1 kg' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('has no presets for each and pack, and steps by 1 from a minimum of 1', async () => {
    const { user, field } = setup(product({ unitType: 'each', packSize: null }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('group', { name: 'Quick amounts' })).not.toBeInTheDocument();
    expect(field()).toHaveValue('1');
    expect(field()).toHaveAccessibleName('Quantity');
    const dec = screen.getByRole('button', { name: 'Decrease quantity' });
    expect(dec).toHaveAttribute('aria-disabled', 'true');
    await user.click(dec);
    expect(field()).toHaveValue('1');
    expect(screen.getByRole('status')).toHaveTextContent('Minimum reached');
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(field()).toHaveValue('2');
  });

  it('uses g and mL defaults, steps and presets', async () => {
    const { user, field } = setup(product({ unitType: 'g' }));
    await screen.findByRole('dialog');
    expect(field()).toHaveValue('500');
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(field()).toHaveValue('600');
    // 1000 g presents as "1 kg" but stays grams.
    await user.click(screen.getByRole('button', { name: '1 kg' }));
    expect(field()).toHaveValue('1000');
    expect(field()).toHaveAccessibleName('Quantity in g');
  });

  it('converts within a family when the unit changes, and resets across families', async () => {
    const { user, field } = setup();
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: '1.5 kg' }));
    await user.click(screen.getByRole('radio', { name: 'g' }));
    expect(field()).toHaveValue('1500');
    expect(screen.getByRole('status')).toHaveTextContent('Unit changed to grams, quantity 1500');
    await user.click(screen.getByRole('radio', { name: 'kg' }));
    expect(field()).toHaveValue('1.5');
    await user.click(screen.getByRole('radio', { name: 'mL' }));
    expect(field()).toHaveValue('500'); // different family: default
    await user.click(screen.getByRole('radio', { name: 'L' }));
    expect(field()).toHaveValue('0.5');
    await user.click(screen.getByRole('radio', { name: 'each' }));
    expect(field()).toHaveValue('1');
    expect(screen.getByRole('radio', { name: 'each' })).toHaveAttribute('aria-checked', 'true');
  });

  it('does not offer the "Remember unit" checkbox yet', async () => {
    const { user } = setup();
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('radio', { name: 'g' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('validates typed entry with the spec messages and blocks confirm', async () => {
    const { user, field, onConfirm } = setup();
    await screen.findByRole('dialog');
    await user.clear(field());
    await user.tab();
    expect(await screen.findByText('Enter a quantity.')).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(field()).toHaveAccessibleDescription('Enter a quantity.');

    await user.type(field(), '25');
    await user.tab();
    expect(screen.getByText('Enter an amount from 0.05 to 20 kg.')).toBeInTheDocument();

    // Activating Add to list while invalid moves focus to the field.
    await user.click(screen.getByRole('button', { name: 'Add to list' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(field()).toHaveFocus();
  });

  it('strips non-numeric characters, accepts a comma, and tidies on blur', async () => {
    const { user, field } = setup();
    await screen.findByRole('dialog');
    await user.clear(field());
    await user.type(field(), 'a1,50x');
    expect(field()).toHaveValue('1.50');
    await user.tab();
    expect(field()).toHaveValue('1.5');
    expect(screen.queryByText(/Enter an amount/)).not.toBeInTheDocument();
  });

  it('asks for whole numbers for each, g and mL', async () => {
    const { user, field } = setup(product({ unitType: 'each' }));
    await screen.findByRole('dialog');
    await user.clear(field());
    await user.type(field(), '1.5');
    await user.keyboard('{Enter}');
    expect(screen.getByText('Use a whole number, like 2.')).toBeInTheDocument();
    await user.clear(field());
    await user.type(field(), '100');
    await user.tab();
    expect(screen.getByText('Enter an amount from 1 to 99.')).toBeInTheDocument();
  });

  it('steps an off-grid typed value to the next multiple in the pressed direction', async () => {
    const { user, field } = setup();
    await screen.findByRole('dialog');
    await user.clear(field());
    await user.type(field(), '1.3');
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(field()).toHaveValue('1.5');
    await user.clear(field());
    await user.type(field(), '1.3');
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(field()).toHaveValue('1.25');
  });

  it('confirms with the chosen quantity, unit and note', async () => {
    const { user, onConfirm } = setup();
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: '1.5 kg' }));
    await user.type(screen.getByLabelText('Note (optional)'), ' get the washed ones ');
    await user.click(screen.getByRole('button', { name: 'Add to list' }));
    expect(onConfirm).toHaveBeenCalledWith({
      product: expect.objectContaining({ name: 'Potatoes' }),
      quantity: 1.5,
      unit: 'kg',
      note: 'get the washed ones',
    });
  });

  it('limits the note to 200 characters with a counter near the limit', async () => {
    const { user } = setup();
    await screen.findByRole('dialog');
    const note = screen.getByLabelText('Note (optional)');
    expect(note).toHaveAttribute('maxlength', '200');
    await user.click(note);
    await user.paste('x'.repeat(160));
    expect(screen.getByText('160/200')).toBeInTheDocument();
  });

  it('Escape, Close and Cancel dismiss without confirming', async () => {
    const { user, onConfirm, onClose } = setup();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByTestId('scrim'));
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('traps focus and makes the page behind inert', async () => {
    const { user } = setup();
    const dialog = await screen.findByRole('dialog');
    const outside = document.createElement('button');
    document.body.prepend(outside);
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 30; i++) await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    outside.remove();
  });

  it('shows "Custom item" for custom products', async () => {
    setup(product({ custom: true, brand: null, packSize: null, name: 'Lamb mince' }));
    expect(await screen.findByText('Custom item')).toBeInTheDocument();
  });
});
