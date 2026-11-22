const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

/** AUD cents -> "$2.19". */
export function formatPrice(cents: number): string {
  return AUD.format(cents / 100);
}

/** First letter for the image fallback. */
export function initialOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** Truncate with an ellipsis for headings and button labels. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}...` : text;
}

/** Title-case the first letter only ("lamb mince" -> "Lamb mince"). */
export function capitaliseFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
