import { useEffect, useRef, useState } from 'react';
import { initialOf } from './format';

interface ProductImageProps {
  src: string | null;
  name: string;
  /** Tailwind classes for the outer box (fixed size / aspect so layout never shifts). */
  className?: string;
  /** Letter size classes for the fallback. */
  letterClassName?: string;
  /** Padding inside the photo box. */
  padding?: string;
}

/**
 * Product photo with a fixed box (no layout shift): lazy, async-decoded, white background
 * (product shots are on white in both themes). Missing or broken images show the first
 * letter of the name on `surface` (docs/ux/search.md 2.3). The title is adjacent, so the
 * image itself is decorative.
 */
export function ProductImage({
  src,
  name,
  className = '',
  letterClassName = 'text-2xl',
  padding = 'p-2',
}: ProductImageProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>(src ? 'loading' : 'error');
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setState(src ? 'loading' : 'error');
  }, [src]);

  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth > 0) setState('loaded');
  }, [src]);

  if (state === 'error' || !src) {
    return (
      <div
        data-testid="image-fallback"
        className={`flex items-center justify-center bg-surface font-bold text-accent ${letterClassName} ${className}`}
      >
        <span aria-hidden>{initialOf(name)}</span>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
      {state === 'loading' && <div aria-hidden className="shimmer absolute inset-0" />}
      <img
        ref={img}
        src={src}
        alt=""
        width={400}
        height={400}
        loading="lazy"
        decoding="async"
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
        className={`h-full w-full object-contain ${padding} ${state === 'loaded' ? '' : 'opacity-0'}`}
      />
    </div>
  );
}
