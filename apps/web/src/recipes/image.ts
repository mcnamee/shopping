import { RECIPE_PHOTO_MAX_BYTES, RECIPE_THUMB_MAX_BYTES } from '@trolley/core';

export const PHOTO_MAX_DIM = 1600;
export const THUMB_MAX_DIM = 400;

export interface PreparedPhoto {
  full: Blob;
  thumb: Blob;
}

type Source = { width: number; height: number; draw: CanvasImageSource; close: () => void };

/** Decode with EXIF orientation applied (createImageBitmap, else an <img>, which also honours it). */
async function decode(file: Blob): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bmp.width, height: bmp.height, draw: bmp, close: () => bmp.close() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: img,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the photo'))),
      'image/jpeg',
      quality,
    ),
  );
}

/** Scale to fit `maxDim` (never up), encode as JPEG, lowering quality until under `maxBytes`. */
async function render(src: Source, maxDim: number, quality: number, maxBytes: number) {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(src.width * scale));
  canvas.height = Math.max(1, Math.round(src.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src.draw, 0, 0, canvas.width, canvas.height);
  let q = quality;
  let blob = await toBlob(canvas, q);
  while (blob.size > maxBytes && q > 0.3) {
    q -= 0.1;
    blob = await toBlob(canvas, q);
  }
  if (blob.size > maxBytes) throw new Error('Photo is too large');
  return blob;
}

/** Resize a picked image to a <= 1600 px JPEG (~0.82) plus a 400 px JPEG thumb (D2, D-105). */
export async function prepareRecipePhoto(file: Blob): Promise<PreparedPhoto> {
  const src = await decode(file);
  try {
    const full = await render(src, PHOTO_MAX_DIM, 0.82, RECIPE_PHOTO_MAX_BYTES);
    const thumb = await render(src, THUMB_MAX_DIM, 0.8, RECIPE_THUMB_MAX_BYTES);
    return { full, thumb };
  } finally {
    src.close();
  }
}
