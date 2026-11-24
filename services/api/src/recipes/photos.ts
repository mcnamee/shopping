/**
 * Recipe photos (D-105, stage-5 B4/B5): private S3 bucket, served same-origin through
 * CloudFront at /media/*. The object key is `media/<photoKey>` so the URL path equals the S3
 * key and CloudFront needs no rewrite. Uploads are presigned POSTs straight to S3 (the
 * policy enforces key, content type and size, so no Lambda sees the bytes and nothing
 * unauthenticated can write); deletes use the Lambda role's DeleteObject on that prefix.
 */
import { randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import {
  RECIPE_PHOTO_MAX_BYTES,
  RECIPE_THUMB_MAX_BYTES,
  recipePhotoKey,
  recipeThumbKey,
  type PresignedPost,
  type RecipePhotoUploadResponse,
} from '@trolley/core';

/** Seconds a presigned POST stays valid. */
export const PHOTO_UPLOAD_EXPIRES_IN = 300;
export const MEDIA_KEY_PREFIX = 'media/';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface PhotoStore {
  /** Presigned POSTs for a new photo (full + thumb) under this household's prefix. */
  presign(householdId: string): Promise<RecipePhotoUploadResponse>;
  /** Delete a photo's full and thumb objects. Never throws (orphans are accepted, B-026). */
  remove(photoKey: string): Promise<void>;
}

export function s3PhotoStore(
  bucket: string,
  client: S3Client = new S3Client({}),
  newId: () => string = randomUUID,
  warn: (entry: Record<string, unknown>) => void = (e) =>
    console.warn(JSON.stringify({ level: 'warn', ...e })),
): PhotoStore {
  async function post(logicalKey: string, maxBytes: number): Promise<PresignedPost> {
    const key = `${MEDIA_KEY_PREFIX}${logicalKey}`;
    const fields = { 'Content-Type': 'image/jpeg', 'Cache-Control': CACHE_CONTROL };
    const signed = await createPresignedPost(client, {
      Bucket: bucket,
      Key: key,
      Expires: PHOTO_UPLOAD_EXPIRES_IN,
      Fields: fields,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', 'image/jpeg'],
        ['eq', '$Cache-Control', CACHE_CONTROL],
      ],
    });
    return { url: signed.url, fields: signed.fields, key, maxBytes };
  }
  return {
    async presign(householdId) {
      const photoKey = recipePhotoKey(householdId, newId());
      const [full, thumb] = await Promise.all([
        post(photoKey, RECIPE_PHOTO_MAX_BYTES),
        post(recipeThumbKey(photoKey), RECIPE_THUMB_MAX_BYTES),
      ]);
      return { photoKey, full, thumb, expiresIn: PHOTO_UPLOAD_EXPIRES_IN };
    },
    async remove(photoKey) {
      try {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: [
                { Key: `${MEDIA_KEY_PREFIX}${photoKey}` },
                { Key: `${MEDIA_KEY_PREFIX}${recipeThumbKey(photoKey)}` },
              ],
              Quiet: true,
            },
          }),
        );
      } catch (err) {
        warn({
          msg: 'recipe_photo_delete_failed',
          error: err instanceof Error ? err.name : 'error',
        });
      }
    },
  };
}
