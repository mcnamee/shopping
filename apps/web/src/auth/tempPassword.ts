/**
 * The temporary password typed at sign-in, held in memory only (never storage or route
 * state) until the set-new-password step, so the new password can be checked against it
 * (B-003). Cleared on use and on leaving the flow.
 */
let temp: string | null = null;

export const rememberTempPassword = (password: string): void => {
  temp = password;
};
export const clearTempPassword = (): void => {
  temp = null;
};
export const matchesTempPassword = (password: string): boolean =>
  temp !== null && password === temp;
