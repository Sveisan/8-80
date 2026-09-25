import { log } from '../log.ts';

export interface PlaceCallRequest {
  to: string;
  /** Their first call ever, which is a different agent with a different prompt. */
  firstCall?: boolean;
  /** Per-caller context, injected into the agent's prompt before the first turn. */
  variables?: Record<string, string>;
  callerIdNumber?: string;
  language?: string;
  ringingTimeoutMs?: number;
  /**
   * Answering-machine detection. On, always, for this product: a fifteen-minute
   * accountability conversation delivered to a voicemail box is not a wasted
   * call, it is somebody's worst week recorded onto a machine their family can
   * play back.
   */
  amd?: boolean;
}

export interface PlacedCall {
  conversationId: string;
  status: string;
}

/**
 * Places calls on Speechify, and reads back what happened.
 *
 * One agent serves every caller — it holds the prompt, the voice and the
 * turn-taking. What differs per person arrives as `dynamic_variables` at call
 * time, which is the mechanism that lets the commitment history stay in our own
 * database rather than in their Memory feature.
 *
 * Their conversations API is read-only: get, messages, recording, end. There is
 * no delete, so a transcript we have already copied into our own encrypted
 * store cannot yet be removed from theirs. That is logged as owed in
 * DECISIONS.md rather than worked around, because there is no way around it.
 */
export class SpeechifyAgent {
  constructor(
    private readonly apiKey: string,
    private readonly agentId: string,
    /** The agent for first calls. Defaults to the one above. */
    private readonly firstCallAgentId: string = agentId,
    private readonly base = 'https://api.speechify.ai',
    /** Which optional fields this account's API will actually accept. */
    private readonly send: {
      variables: boolean;
      amd: boolean;
      ringingTimeout: boolean;
      language: boolean;
    } = { variables: false, amd: false, ringingTimeout: false, language: false },
  ) {}

  async placeCall(req: PlaceCallRequest): Promise<PlacedCall> {
    // agent_id and to are the two fields proven to work against the live API.
    // Everything else is optional in their documentation and each one is opt-in
    // here, because a body carrying all of them came back "Request body is not
    // valid JSON" — a message that says nothing about which field offended, so
    // the only way through is one at a time. `send` says which are allowed.
    const body: Record<string, unknown> = {
      agent_id: req.firstCall ? this.firstCallAgentId : this.agentId,
      to: req.to,
      ...(req.callerIdNumber ? { caller_id_number: req.callerIdNumber } : {}),
      ...(this.send.variables && req.variables ? { dynamic_variables: req.variables } : {}),
      ...(this.send.language && req.language ? { language: req.language } : {}),
      ...(this.send.ringingTimeout && req.ringingTimeoutMs ? { ringing_timeout_ms: req.ringingTimeoutMs } : {}),
      ...(this.send.amd && req.amd !== undefined ? { amd: req.amd } : {}),
    };

    const res = await this.post('/v1/agents/outbound-calls', body);
    const out = res as { conversation_id?: string; status?: string };
    if (!out.conversation_id) throw new Error('Speechify accepted the call but returned no conversation_id');

    // The number is in the request, never in a log line.
    log('agent.call_placed', { conversationId: out.conversation_id, status: out.status ?? 'pending' });
    return { conversationId: out.conversation_id, status: out.status ?? 'pending' };
  }

  /** The conversation record, for when a webhook was missed rather than not sent. */
  async conversation(conversationId: string): Promise<unknown> {
    const res = await fetch(`${this.base}/v1/conversations/${encodeURIComponent(conversationId)}`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Speechify refused the conversation read (HTTP ${res.status})`);
    return await res.json();
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Their validator echoes the request back on a 4xx, phone number and all
      // — which is why this looked unloggable at first. It is not: log() strips
      // numbers and addresses from every string at any depth, so the one thing
      // that says *why* a call did not happen can be read without leaking who
      // it was for. A 400 with nothing but its status attached is a morning
      // spent guessing.
      const detail = await res.text().catch(() => '');
      // The field names, never the values: which key was too much is the whole
      // question, and the values are a phone number and somebody's commitment.
      log('agent.call_failed', {
        status: res.status,
        path,
        sent: Object.keys(body as Record<string, unknown>),
        detail: detail.slice(0, 600),
      });
      throw new CallNotPlaced(res.status, detail, path);
    }
    return await res.json();
  }
}

/**
 * Two very different things arrive here as the same HTTP failure.
 *
 * "The carrier refused the call" means nobody was rung: the request never
 * became a ringing telephone, and trying again in two seconds is the right
 * response. "The destination did not answer" means somebody's phone rang and
 * they did not pick it up — which is not an error at all, it is the answer,
 * and the correct response is the one missed-call text.
 *
 * Retrying the second one rings a person three times in seventy seconds from
 * an unknown number, which is the precise opposite of what this product is.
 * It did exactly that until this class existed, and the two cases were
 * indistinguishable because the only thing on the error was a status code.
 */
export class CallNotPlaced extends Error {
  readonly code: string;
  readonly reason: string;
  /**
   * Their request id, which is the only thing their support can look up.
   *
   * It was in the journal and nowhere else, so handing it over meant grepping
   * for it — and the attempt row, the thing anybody actually reads when a call
   * did not happen, did not have it. A failure nobody can escalate is a
   * failure that waits for somebody to guess.
   */
  readonly requestId: string;
  /** True when the telephone actually rang and nobody answered it. */
  readonly rang: boolean;

  constructor(
    readonly status: number,
    detail: string,
    path: string,
  ) {
    const parsed = safeError(detail);
    super(
      `Speechify refused ${path} (HTTP ${status})${parsed.message ? `: ${parsed.message}` : ''}` +
        `${parsed.requestId ? ` [request ${parsed.requestId}]` : ''}`,
    );
    this.name = 'CallNotPlaced';
    this.code = parsed.code;
    this.reason = parsed.message;
    this.requestId = parsed.requestId;
    this.rang = NO_ANSWER.test(parsed.message);
  }
}

/** Their words for a phone that rang and was not picked up. */
const NO_ANSWER = /did not answer|no answer|not answered|busy|declined|rejected|unavailable|timed out/i;

function safeError(detail: string): { code: string; message: string; requestId: string } {
  try {
    const body = JSON.parse(detail) as { error?: { code?: unknown; message?: unknown }; request_id?: unknown };
    return {
      code: typeof body.error?.code === 'string' ? body.error.code : '',
      message: typeof body.error?.message === 'string' ? body.error.message : '',
      requestId: typeof body.request_id === 'string' ? body.request_id : '',
    };
  } catch {
    return { code: '', message: '', requestId: '' };
  }
}
