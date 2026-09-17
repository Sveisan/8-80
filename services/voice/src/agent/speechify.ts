import { log } from '../log.ts';

export interface PlaceCallRequest {
  to: string;
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
      agent_id: this.agentId,
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
      throw new Error(`Speechify refused ${path} (HTTP ${res.status})`);
    }
    return await res.json();
  }
}
