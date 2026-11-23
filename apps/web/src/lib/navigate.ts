/** Full-page navigation away from the SPA (isolated so tests can replace it). */
export function goExternal(url: string): void {
  window.location.assign(url);
}
