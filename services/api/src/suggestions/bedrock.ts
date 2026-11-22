/**
 * Amazon Bedrock Converse call for the suggestions AI pass (D-061, D-070). The model id is
 * an inference profile id such as `apac.amazon.nova-micro-v1:0` (CDK context
 * `suggestModelId`, Lambda env SUGGEST_MODEL_ID). No retries: one attempt, bounded by the
 * caller's timeout, then the rules result is used.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { AiPrompt } from './ai';

/** Output cap (B6): 40 candidates x ~25 tokens each fits comfortably. */
export const AI_MAX_TOKENS = 1000;
export const AI_TEMPERATURE = 0.2;

/** Anything with the client's `send` (tests inject a fake). */
export interface ConverseSender {
  send(
    command: ConverseCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Pick<ConverseCommandOutput, 'output' | 'stopReason'>>;
}

/** Sends the prompt and returns the model's text. Rejects on any failure. */
export type AiTextModel = (prompt: AiPrompt, signal: AbortSignal) => Promise<string>;

export function bedrockModel(modelId: string, client?: ConverseSender): AiTextModel {
  const sender: ConverseSender = client ?? new BedrockRuntimeClient({ maxAttempts: 1 });
  return async (prompt, signal) => {
    const res = await sender.send(
      new ConverseCommand({
        modelId,
        system: [{ text: prompt.system }],
        messages: [{ role: 'user', content: [{ text: prompt.user }] }],
        inferenceConfig: { maxTokens: AI_MAX_TOKENS, temperature: AI_TEMPERATURE, topP: 0.9 },
      }),
      { abortSignal: signal },
    );
    const text = (res.output?.message?.content ?? [])
      .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
      .join('');
    if (!text) throw new Error(`Empty model reply (${String(res.stopReason)})`);
    return text;
  };
}
