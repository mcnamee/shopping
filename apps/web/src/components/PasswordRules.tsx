import { Circle, CircleAlert, CircleCheck } from 'lucide-react';
import { PASSWORD_RULES } from '../lib/password';

/**
 * Live rules checklist (docs/ux/auth.md section 2). Neutral until a failed submit, then
 * unmet rules turn red. State is never colour alone: icon + visually-hidden text.
 */
export function PasswordRules({
  password,
  showErrors,
  id,
}: {
  password: string;
  showErrors: boolean;
  id?: string;
}) {
  return (
    <div className="mt-3">
      <p className="text-sm text-muted" id={id ? `${id}-label` : undefined}>
        Your password needs:
      </p>
      <ul
        id={id}
        aria-live="polite"
        aria-labelledby={id ? `${id}-label` : undefined}
        className="mt-1 space-y-1"
      >
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(password);
          const failed = !met && showErrors;
          const Icon = met ? CircleCheck : failed ? CircleAlert : Circle;
          const tone = met ? 'text-success' : failed ? 'text-danger' : 'text-muted';
          return (
            <li key={rule.id} className={`flex items-center gap-2 text-sm ${tone}`}>
              <Icon aria-hidden className="h-4 w-4 shrink-0" />
              <span>
                {rule.label}
                <span className="sr-only">{met ? ' - met' : ' - not met'}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
