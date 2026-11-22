// Generates icon.svg and the PWA PNG icons from the Trolley brand logo (flat shapes on royal blue).
// Run: npm run icons -w @trolley/web   (outputs are committed; only re-run if the logo changes)
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const outDir = fileURLToPath(new URL('../public/', import.meta.url));
const BLUE = '#1B36FF';

// Logo shapes in the original artwork space (1080x1350, logo centred on 540,675).
const shapes = `
    <path fill="#fff" d="M248 450H423L495 737H831V802H445L372 515H248Z"/>
    <path fill="#FE574F" d="M574 450L739 417L750 482L585 511Z"/>
    <path fill="#FEC917" d="M504 505L668 538L656 600L491 567Z"/>
    <path fill="#fff" d="M523 651L785 580L802 641L539 713Z"/>
    <circle fill="#FE574F" cx="543" cy="887" r="46"/>
    <circle fill="#FE574F" cx="725" cy="887" r="46"/>`;

// `scale` sizes the logo inside a 512 box (smaller for maskable safe zones).
const svg = (scale, rounded) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="96" ' : ''}fill="${BLUE}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-540 -675)">${shapes}
  </g>
</svg>`;

const png = (name, size, markup) =>
  sharp(Buffer.from(markup), { density: 384 })
    .resize(size, size)
    .flatten({ background: BLUE })
    .png()
    .toFile(`${outDir}${name}`);

await mkdir(outDir, { recursive: true });
// Logo is ~60% of the tile (any); ~50% for maskable, well inside the central 80% safe zone.
await png('icons/icon-192.png', 192, svg(0.53, false));
await png('icons/icon-512.png', 512, svg(0.53, false));
await png('icons/icon-maskable-512.png', 512, svg(0.46, false));
await png('icons/apple-touch-icon.png', 180, svg(0.53, false));
await writeFile(`${outDir}icon.svg`, svg(0.53, true) + '\n');
console.log('Icons written to', outDir);
