/** Trolley glyph (same shape as the PWA icon), drawn in currentColor. */
export function TrolleyGlyph({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="100 120 340 300"
      className={className}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M120 150h40l40 170h170l36-120H186" />
      </g>
      <circle cx="220" cy="380" r="24" fill="currentColor" />
      <circle cx="350" cy="380" r="24" fill="currentColor" />
    </svg>
  );
}
