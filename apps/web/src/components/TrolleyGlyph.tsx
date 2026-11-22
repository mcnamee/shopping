/** Trolley brand mark (same artwork as the PWA icon): flat shapes on a rounded royal-blue tile. */
export function TrolleyGlyph({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
    >
      <rect width="512" height="512" rx="96" fill="#1B36FF" />
      <g transform="translate(256 256) scale(0.53) translate(-540 -675)">
        <path fill="#fff" d="M248 450H423L495 737H831V802H445L372 515H248Z" />
        <path fill="#FE574F" d="M574 450L739 417L750 482L585 511Z" />
        <path fill="#FEC917" d="M504 505L668 538L656 600L491 567Z" />
        <path fill="#fff" d="M523 651L785 580L802 641L539 713Z" />
        <circle fill="#FE574F" cx="543" cy="887" r="46" />
        <circle fill="#FE574F" cx="725" cy="887" r="46" />
      </g>
    </svg>
  );
}
