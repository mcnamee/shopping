/** Password rules (match the Cognito pool policy). docs/ux/auth.md section 2. */
export interface PasswordRule {
  id: 'length' | 'upper' | 'lower' | 'number';
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', label: 'An uppercase letter (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'A lowercase letter (a-z)', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: 'A number (0-9)', test: (p) => /\d/.test(p) },
];

export const passwordMeetsRules = (password: string): boolean =>
  PASSWORD_RULES.every((rule) => rule.test(password));
