// Generates the PWA PNG icons from a simple trolley glyph (docs/ux/app-shell.md section 6).
// Run: npm run icons -w @trolley/web   (outputs are committed; only re-run if the glyph changes)
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const outDir = fileURLToPath(new URL('../public/', import.meta.url));
const TEAL = '#0B6B63';

// Glyph drawn in a 512 box, centred, white. `scale` shrinks it for maskable safe zones.
const glyph = (scale) => `
  <g transform="translate(256 256) scale(${scale}) translate(-263 -270)" fill="none" stroke="#fff"
     stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <path d="M120 150h40l40 170h170l36-120H186"/>
    <circle cx="220" cy="380" r="24" fill="#fff" stroke="none"/>
    <circle cx="350" cy="380" r="24" fill="#fff" stroke="none"/>
  </g>`;

const svg = (scale, rounded) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="96" ' : ''}fill="${TEAL}"/>${glyph(scale)}</svg>`;

const png = (name, size, markup) =>
  sharp(Buffer.from(markup), { density: 384 })
    .resize(size, size)
    .flatten({ background: TEAL })
    .png()
    .toFile(`${outDir}${name}`);

await mkdir(outDir, { recursive: true });
// Glyph occupies roughly the middle 60% (any) / within the central 80% safe zone (maskable).
await png('icons/icon-192.png', 192, svg(0.95, false));
await png('icons/icon-512.png', 512, svg(0.95, false));
await png('icons/icon-maskable-512.png', 512, svg(0.8, false));
await png('icons/apple-touch-icon.png', 180, svg(0.95, false));
await writeFile(`${outDir}icon.svg`, svg(0.95, true) + '\n');
console.log('Icons written to', outDir);
