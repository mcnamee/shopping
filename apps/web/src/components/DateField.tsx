import { CalendarDays } from 'lucide-react';

/**
 * A native date input that cannot overflow its container (iOS Safari gives date inputs an
 * intrinsic minimum width): block, full width, no native chrome, left-aligned value and a
 * custom calendar icon on the right. The input keeps the id and label the caller gives it.
 */
export function DateField({
  id,
  value,
  min,
  onChange,
}: {
  id: string;
  value: string;
  min?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative block w-full min-w-0 max-w-full">
      <input
        id={id}
        type="date"
        value={value}
        {...(min ? { min } : {})}
        onChange={(e) => onChange(e.target.value)}
        className="block min-h-primary w-full min-w-0 max-w-full appearance-none rounded-md border-2 border-border bg-surface py-0 pl-3 pr-11 text-left text-base text-text focus:border-accent [&::-webkit-date-and-time-value]:text-left [&::-webkit-datetime-edit]:p-0"
      />
      <CalendarDays
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
