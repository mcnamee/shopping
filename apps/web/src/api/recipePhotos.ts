import type { PresignedPost, RecipePhotoUploadResponse } from '@trolley/core';

/** POST one file to an S3 presigned POST: the signed fields first, `file` last. */
async function postToS3(post: PresignedPost, blob: Blob): Promise<void> {
  if (post.url.startsWith('mock://')) {
    const { mockStorePhoto } = await import('./mock-stage5');
    await mockStorePhoto(post.key, blob);
    return;
  }
  const form = new FormData();
  for (const [name, value] of Object.entries(post.fields)) form.append(name, value);
  form.append('file', blob);
  const res = await fetch(post.url, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
}

/**
 * Upload the resized photo and its thumbnail (both JPEG blobs, at most `full.maxBytes` and
 * `thumb.maxBytes`) with the response of getRecipePhotoUpload(). Throws when either fails;
 * then keep the form and show "Photo didn't upload. Try again." (D2). On success save the
 * recipe with `photoKey: upload.photoKey`.
 */
export async function uploadRecipePhoto(
  upload: RecipePhotoUploadResponse,
  full: Blob,
  thumb: Blob,
): Promise<void> {
  if (full.size > upload.full.maxBytes || thumb.size > upload.thumb.maxBytes) {
    throw new Error('Photo is too large');
  }
  await Promise.all([postToS3(upload.full, full), postToS3(upload.thumb, thumb)]);
}
