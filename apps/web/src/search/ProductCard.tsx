import type { ProductSummary } from '@trolley/core';
import { Check, ListPlus, Plus, Tag } from 'lucide-react';
import { forwardRef } from 'react';
import { formatPrice } from './format';
import { ProductImage } from './ProductImage';

interface ProductCardProps {
  product: ProductSummary;
  /** Shows "Added" briefly after the quantity modal confirms. */
  added: boolean;
  onAdd: (product: ProductSummary, button: HTMLButtonElement) => void;
  onTemplate: (product: ProductSummary) => void;
}

/** Search result card (docs/ux/search.md 2.3). Not itself tappable: two buttons only. */
export const ProductCard = forwardRef<HTMLLIElement, ProductCardProps>(function ProductCard(
  { product, added, onAdd, onTemplate },
  ref,
) {
  const { name, brand, price, packSize, custom } = product;
  return (
    <li
      ref={ref}
      className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-raised"
    >
      <div className="relative">
        <ProductImage src={product.imageUrl} name={name} className="aspect-square w-full" />
        <button
          type="button"
          aria-label={`Add ${name} to a template`}
          onClick={() => onTemplate(product)}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-surface-raised/90 text-text">
            <ListPlus aria-hidden className="h-5 w-5" />
          </span>
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 min-h-12 text-base font-semibold leading-6">{name}</h3>
        <p className="min-h-5 truncate text-sm text-muted">
          {custom ? (
            <span className="inline-flex items-center gap-1 font-semibold text-accent">
              <Tag aria-hidden className="h-3.5 w-3.5" />
              Custom
            </span>
          ) : (
            brand
          )}
        </p>
        <p className="min-h-[26px] truncate">
          {price !== null && (
            <span className="text-lg font-bold text-text">{formatPrice(price)}</span>
          )}
          {price !== null && packSize && <span className="text-sm text-muted">{' · '}</span>}
          {packSize && <span className="text-sm text-muted">{packSize}</span>}
        </p>
        <div className="mt-auto pt-2">
          <button
            type="button"
            aria-label={`Add ${name} to list`}
            onClick={(e) => onAdd(product, e.currentTarget)}
            className={`flex h-12 w-full items-center justify-center gap-1 rounded-md text-lg font-semibold transition-colors ${
              added
                ? 'bg-success-soft text-success'
                : 'bg-accent text-accent-on active:bg-accent-strong'
            }`}
          >
            {added ? (
              <>
                <Check aria-hidden className="h-5 w-5" />
                Added
              </>
            ) : (
              <>
                <Plus aria-hidden className="h-5 w-5" />
                Add
              </>
            )}
          </button>
        </div>
      </div>
    </li>
  );
});

/** Skeleton with the same dimensions as a real card. */
export function ProductCardSkeleton() {
  return (
    <li
      aria-hidden
      className="overflow-hidden rounded-md border border-border-subtle bg-surface-raised"
    >
      <div className="shimmer aspect-square w-full" />
      <div className="space-y-2 p-3">
        <div className="shimmer h-4 w-5/6 rounded-sm" />
        <div className="shimmer h-4 w-3/5 rounded-sm" />
        <div className="shimmer h-3.5 w-2/5 rounded-sm" />
        <div className="shimmer h-6 w-1/2 rounded-sm" />
        <div className="shimmer mt-2 h-12 w-full rounded-md" />
      </div>
    </li>
  );
}
