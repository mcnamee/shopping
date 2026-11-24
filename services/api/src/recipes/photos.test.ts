import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { s3PhotoStore } from './photos';

const client = () =>
  new S3Client({
    region: 'ap-southeast-2',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'tok' },
  });

describe('s3PhotoStore.presign (B4)', () => {
  it('signs POSTs pinned to the key, image/jpeg, the size cap and the cache header', async () => {
    const store = s3PhotoStore('bucket-1', client(), () => '11111111-2222-4333-8444-555555555555');
    const res = await store.presign('home-1');
    expect(res.photoKey).toBe('recipes/home-1/11111111-2222-4333-8444-555555555555.jpg');
    expect(res.full.url).toBe('https://bucket-1.s3.ap-southeast-2.amazonaws.com/');
    for (const [post, max, key] of [
      [res.full, 3 * 1024 * 1024, `media/${res.photoKey}`],
      [res.thumb, 300 * 1024, `media/${res.photoKey.replace('.jpg', '-thumb.jpg')}`],
    ] as const) {
      expect(post.key).toBe(key);
      expect(post.fields.key).toBe(key);
      expect(post.fields['Content-Type']).toBe('image/jpeg');
      const policy = JSON.parse(Buffer.from(post.fields.Policy as string, 'base64').toString()) as {
        expiration: string;
        conditions: unknown[];
      };
      const flat = JSON.stringify(policy.conditions);
      expect(flat).toContain(JSON.stringify(['content-length-range', 1, max]));
      expect(flat).toContain(JSON.stringify({ key }));
      expect(flat).toContain(JSON.stringify({ bucket: 'bucket-1' }));
      expect(flat).toContain('image/jpeg');
      expect(Date.parse(policy.expiration)).toBeGreaterThan(Date.now());
      expect(Date.parse(policy.expiration)).toBeLessThanOrEqual(Date.now() + 301_000);
    }
    expect(res.expiresIn).toBe(300);
  });
});

describe('s3PhotoStore.remove (D-105)', () => {
  it('deletes the full and thumb objects, and never throws', async () => {
    const sent: unknown[] = [];
    const c = client();
    (c as unknown as { send: (cmd: unknown) => Promise<unknown> }).send = async (cmd) => {
      sent.push(cmd);
      return {};
    };
    const store = s3PhotoStore('bucket-1', c);
    await store.remove('recipes/home-1/abc.jpg');
    const cmd = sent[0] as DeleteObjectsCommand;
    expect(cmd).toBeInstanceOf(DeleteObjectsCommand);
    expect(cmd.input.Delete?.Objects?.map((o) => o.Key)).toEqual([
      'media/recipes/home-1/abc.jpg',
      'media/recipes/home-1/abc-thumb.jpg',
    ]);
    const warnings: unknown[] = [];
    const failing = client();
    (failing as unknown as { send: () => Promise<never> }).send = async () => {
      throw new Error('boom');
    };
    await expect(
      s3PhotoStore('b', failing, undefined, (e) => warnings.push(e)).remove(
        'recipes/home-1/abc.jpg',
      ),
    ).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});
