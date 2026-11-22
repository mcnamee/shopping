import { formatQuantity, formatQuantityNumber, isCountUnit, type UnitType } from '@trolley/core';

/** Row quantity: "2 x" for counted units, "1.5 kg" / "500 mL" for the rest. */
export function qtyLabel(qty: number, unit: UnitType): string {
  return isCountUnit(unit) ? `${formatQuantityNumber(qty, unit)} x` : formatQuantity(qty, unit);
}

const TZ = 'Australia/Sydney';
const dayFmt = new Intl.DateTimeFormat('en-AU', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const longDayFmt = new Intl.DateTimeFormat('en-AU', {
  timeZone: TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const monthFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-AU', {
  timeZone: TZ,
  hour: 'numeric',
  minute: '2-digit',
});

const strip = (s: string) => s.replace(',', '');

/** "Sun 22 Nov". */
export const shortDay = (iso: string) => strip(dayFmt.format(new Date(iso)));
/** "Sunday 22 November". */
export const longDay = (iso: string) => strip(longDayFmt.format(new Date(iso)));
/** "November 2026". */
export const monthLabel = (iso: string) => monthFmt.format(new Date(iso));
/** "2:41 pm". */
export const clockTime = (at: number) =>
  timeFmt
    .format(new Date(at))
    .replace(/\s?([ap])m/i, ' $1m')
    .toLowerCase();

/** "Updated just now" ... "Updated at 2:41 pm" (docs/ux/lists.md 3.8). */
export function updatedLabel(updatedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 15) return 'Updated just now';
  if (s < 60) return `Updated ${Math.floor(s / 5) * 5} s ago`;
  const m = Math.floor(s / 60);
  if (m < 5) return `Updated ${m} min ago`;
  if (m < 60) return `Updated ${Math.floor(m / 5) * 5} min ago`;
  return `Updated at ${clockTime(updatedAt)}`;
}

export const countLabel = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
