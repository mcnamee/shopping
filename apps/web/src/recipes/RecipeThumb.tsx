import { ChefHat } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Recipe photo with a fixed box; falls back to an icon when missing or broken. */
export function RecipePhoto({
  src,
  className = '',
  eager = false,
}: {
  src: string | null;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div
        data-testid="recipe-photo-fallback"
        aria-hidden
        className={`flex items-center justify-center bg-accent-soft text-accent ${className}`}
      >
        <ChefHat className="h-1/3 w-1/3 max-h-12 max-w-12" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className={`bg-surface object-cover ${className}`}
    />
  );
}
