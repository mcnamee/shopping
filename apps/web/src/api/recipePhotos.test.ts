// @vitest-environment jsdom
import type { RecipePhotoUploadResponse } from '@trolley/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadRecipePhoto } from './recipePhotos';

const upload: RecipePhotoUploadResponse = {
  photoKey: 'recipes/home-1/abc.jpg',
  expiresIn: 300,
  full: {
    url: 'https://bucket.s3.ap-southeast-2.amazonaws.com/',
    key: 'media/recipes/home-1/abc.jpg',
    maxBytes: 3 * 1024 * 1024,
    fields: { key: 'media/recipes/home-1/abc.jpg', 'Content-Type': 'image/jpeg', Policy: 'p' },
  },
  thumb: {
    url: 'https://bucket.s3.ap-southeast-2.amazonaws.com/',
    key: 'media/recipes/home-1/abc-thumb.jpg',
    maxBytes: 300 * 1024,
    fields: {
      key: 'media/recipes/home-1/abc-thumb.jpg',
      'Content-Type': 'image/jpeg',
      Policy: 'q',
    },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('uploadRecipePhoto', () => {
  it('POSTs both files as multipart with the signed fields first and the file last', async () => {
    const calls: Array<{ url: string; names: string[] }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: FormData }) => {
      calls.push({ url, names: [...init.body.keys()] });
      return new Response(null, { status: 204 });
    });
    await uploadRecipePhoto(upload, new Blob(['a']), new Blob(['b']));
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.url).toBe('https://bucket.s3.ap-southeast-2.amazonaws.com/');
      expect(c.names).toEqual(['key', 'Content-Type', 'Policy', 'file']);
    }
  });

  it('throws when S3 refuses a file, and before sending an over-size one', async () => {
    vi.stubGlobal('fetch', async () => new Response('<Error/>', { status: 403 }));
    await expect(uploadRecipePhoto(upload, new Blob(['a']), new Blob(['b']))).rejects.toThrow(
      /403/,
    );
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(
      uploadRecipePhoto(upload, new Blob(['a']), new Blob([new Uint8Array(300 * 1024 + 1)])),
    ).rejects.toThrow(/too large/);
    expect(spy).not.toHaveBeenCalled();
  });
});
