const dateFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });

/** "23 Nov". */
export const connectedDate = (iso: string) => dateFmt.format(new Date(iso));

/** "never used", "just now", "5 min ago", "2 h ago", "3 days ago", else a date. */
export function lastUsedLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never used';
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'last used just now';
  if (m < 60) return `last used ${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `last used ${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `last used ${d} ${d === 1 ? 'day' : 'days'} ago`;
  return `last used ${connectedDate(iso)}`;
}
