import type { Turn } from '../call/outcome.ts';
import { jevQuestions } from './jev-rubric.ts';

export const JEV_MODEL = 'jev-1.14.0';
export const JEV_POLICY = { clearMax: 0.3, flagMin: 0.7 } as const;
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MAX_REQUEST_BYTES = 64_000;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_TIMEOUT_MS = 4_000;

export interface JevReviewInput {
  conversation: readonly Turn[];
  candidateRecap: string;
  /** Independently verified facts only; omit when none are available. */
  trustedContext?: Readonly<Record<string, string>>;
}
type Verdict = { state: 'flag' | 'clear' | 'uncertain'; probability: number };
type Reason = 'missing_key' | 'invalid_input' | 'payload_too_large' | 'timeout'
  | 'provider_error' | 'invalid_response' | 'model_mismatch' | 'response_too_large';
export type JevReview = {
  advisoryOnly: true;
  policy: typeof JEV_POLICY;
} & ({ status: 'disabled' } | { status: 'unavailable'; reason: Reason }
  | { status: 'reviewed'; model: typeof JEV_MODEL; repeatedQuestion: Verdict; unsupportedRecap: Verdict });
interface Options {
  enabled?: boolean;
  apiKey?: string;
  /** Shorter deadlines are useful for offline contract tests; never above 4s. */
  timeoutMs?: number;
  fetcher?: typeof fetch;
}
class ReviewFailure extends Error {
  constructor(readonly reason: Reason) { super(reason); }
}
const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;

function requestBody(input: JevReviewInput): string {
  if (!Array.isArray(input?.conversation) || input.conversation.length === 0 || input.conversation.length > 1000
    || typeof input.candidateRecap !== 'string' || !input.candidateRecap.trim()
    || input.conversation.some(t => !t || !['agent', 'caller'].includes(t.speaker) || typeof t.text !== 'string')) {
    throw new ReviewFailure('invalid_input');
  }
  const context = input.trustedContext ?? {};
  if (!record(context) || Object.entries(context).length > 50
    || Object.values(context).some(v => typeof v !== 'string')) throw new ReviewFailure('invalid_input');
  // Never send provider identifiers, phone/email metadata, duration, labels,
  // expected decisions or additional fields from a retained delivery.
  const state = {
    conversation: input.conversation.map(t => ({ speaker: t.speaker, text: t.text })),
    candidate_recap: input.candidateRecap,
    trusted_context: context,
  };
  const body = JSON.stringify({ model: JEV_MODEL, state, questions: jevQuestions });
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new ReviewFailure('payload_too_large');
  return body;
}
function verdict(value: unknown): Verdict {
  const answer = record(value);
  const probability = answer?.['noul'];
  if (answer?.['type'] !== 'noul' || typeof probability !== 'number' || !Number.isFinite(probability)
    || probability < 0 || probability > 1) throw new ReviewFailure('invalid_response');
  return { probability, state: probability >= JEV_POLICY.flagMin ? 'flag'
    : probability <= JEV_POLICY.clearMax ? 'clear' : 'uncertain' };
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new ReviewFailure('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new ReviewFailure('response_too_large');
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new ReviewFailure('invalid_response'); }
}

/** Explicit opt-in post-call advice. No retries, logging or caller-state writes.
 * Never await this from a live call, settlement, recap delivery or webhook path.
 * Failures and the uncertainty band are not evidence that a call/recap passed. */
export async function reviewWithJev(input: JevReviewInput, options: Options = {}): Promise<JevReview> {
  const base = { advisoryOnly: true, policy: JEV_POLICY } as const;
  if (options.enabled !== true) return { ...base, status: 'disabled' };
  const key = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
  if (!key || /\s/.test(key)) return { ...base, status: 'unavailable', reason: 'missing_key' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = requestBody(input);
    const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
      ? Math.max(1, Math.min(MAX_TIMEOUT_MS, options.timeoutMs)) : MAX_TIMEOUT_MS;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ReviewFailure('timeout'));
      }, timeoutMs);
    });
    const request = async (): Promise<JevReview> => {
      const response = await (options.fetcher ?? fetch)(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new ReviewFailure('provider_error');
      }
      const result = record(await boundedJson(response));
      if (typeof result?.['model'] !== 'string') throw new ReviewFailure('invalid_response');
      if (result['model'] !== JEV_MODEL) throw new ReviewFailure('model_mismatch');
      const answers = record(result['answers']);
      return { ...base, status: 'reviewed', model: JEV_MODEL,
        repeatedQuestion: verdict(answers?.['repeated_question']),
        unsupportedRecap: verdict(answers?.['unsupported_recap']) };
    };
    return await Promise.race([request(), deadline]);
  } catch (error) {
    return { ...base, status: 'unavailable', reason: controller.signal.aborted ? 'timeout'
      : error instanceof ReviewFailure ? error.reason : 'provider_error' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
