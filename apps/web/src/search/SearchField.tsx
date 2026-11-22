import { Search, X } from 'lucide-react';
import { forwardRef } from 'react';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Keyboard Search key: run now and drop the keyboard. */
  onSubmit: () => void;
  onClear: () => void;
}

/** 56px search input with a 44px clear button (docs/ux/search.md 2.1). */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, onSubmit, onClear },
  ref,
) {
  return (
    <form
      role="search"
      className="pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="product-search" className="sr-only">
        Search products
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-6 w-6 -translate-y-1/2 text-muted"
        />
        <input
          ref={ref}
          id="product-search"
          type="search"
          enterKeyHint="search"
          inputMode="search"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search ALDI products"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block min-h-primary w-full appearance-none rounded-md border-2 border-border bg-surface pl-12 pr-12 text-base text-text placeholder:text-muted focus:border-accent [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            // Keep the keyboard up: do not steal focus from the input on press.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            className="absolute inset-y-0 right-1 my-auto flex h-11 w-11 items-center justify-center rounded-sm text-muted"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        )}
      </div>
    </form>
  );
});
