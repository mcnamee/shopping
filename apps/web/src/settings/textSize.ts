export type TextSize = 'small' | 'medium' | 'large';

export const TEXT_SIZES: readonly { value: TextSize; label: string; px: number }[] = [
  { value: 'small', label: 'Small', px: 14 },
  { value: 'medium', label: 'Medium', px: 15 },
  { value: 'large', label: 'Large', px: 16 },
];

export const TEXT_SIZE_KEY = 'trolley.textSize';
export const DEFAULT_TEXT_SIZE: TextSize = 'medium';

export function readTextSize(): TextSize {
  try {
    const v = window.localStorage.getItem(TEXT_SIZE_KEY);
    if (v === 'small' || v === 'medium' || v === 'large') return v;
  } catch {
    // Storage blocked: fall back to the default.
  }
  return DEFAULT_TEXT_SIZE;
}

/** Scales every rem-based size by setting the root font size. */
export function applyTextSize(size: TextSize): void {
  const px = TEXT_SIZES.find((s) => s.value === size)?.px ?? 16;
  document.documentElement.style.fontSize = `${px}px`;
}

export function saveTextSize(size: TextSize): void {
  try {
    window.localStorage.setItem(TEXT_SIZE_KEY, size);
  } catch {
    // Not persisted; still applies for this session.
  }
  applyTextSize(size);
}
