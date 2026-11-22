import { describe, expect, it } from 'vitest';
import { assertModelId, DEFAULT_SUGGEST_MODEL_ID, parseModelId } from '../lib/config';

describe('suggestModelId', () => {
  it('accepts inference profile ids, foundation model ids and "none"', () => {
    for (const id of [
      DEFAULT_SUGGEST_MODEL_ID,
      'apac.amazon.nova-lite-v1:0',
      'au.anthropic.claude-haiku-4-5-20251001-v1:0',
      'amazon.nova-micro-v1:0',
      'none',
    ]) {
      expect(assertModelId(id)).toBe(id);
    }
  });

  it('rejects ARNs, wildcards and junk', () => {
    for (const id of ['*', 'amazon.*', 'arn:aws:bedrock:x', 'nova micro', '', 'APAC.amazon.nova']) {
      expect(() => assertModelId(id)).toThrow(/suggestModelId/);
    }
  });

  it('splits a cross-region profile id into profile and foundation model', () => {
    expect(parseModelId('apac.amazon.nova-micro-v1:0')).toEqual({
      profileId: 'apac.amazon.nova-micro-v1:0',
      foundationModelId: 'amazon.nova-micro-v1:0',
    });
    expect(parseModelId('global.anthropic.claude-x-v1:0').profileId).toBe(
      'global.anthropic.claude-x-v1:0',
    );
    expect(parseModelId('amazon.nova-micro-v1:0')).toEqual({
      profileId: null,
      foundationModelId: 'amazon.nova-micro-v1:0',
    });
  });
});
