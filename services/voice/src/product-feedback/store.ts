import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { decrypt, encrypt } from '../store/crypto.ts';
import { digest, RETENTION_MS, type FeedbackInput, type FeedbackState } from './model.ts';

export class FeedbackLimit extends Error {}
export class FeedbackConflict extends Error {}
export class FeedbackStore {
  constructor(readonly sql: postgres.Sql) {}

  async save(session: string, bucket: string, requestId: string, input: FeedbackInput, phoneHash?: string, now = new Date()): Promise<string> {
    return this.sql.begin(async tx => {
      // The same limit applies across replicas, browser resets and retrying submissions.
      await tx`select pg_advisory_xact_lock(hashtextextended(${bucket}, 17))`;
      const [prior] = await tx`select id,payload_enc from product_feedback where session_hash=${digest(session)} and request_id=${requestId}`;
      if (prior) {
        const previous=JSON.parse(decrypt(String(prior['payload_enc']))) as FeedbackInput;
        if (JSON.stringify({...previous,release:''}) !== JSON.stringify({...input,release:''})) throw new FeedbackConflict();
        return String(prior['id']);
      }
      const [n] = await tx`select count(*)::int as n from product_feedback where client_bucket=${bucket} and created_at > ${new Date(+now - 86400_000)}`;
      if (Number(n?.['n']) >= 10) throw new FeedbackLimit();
      const id = randomUUID();
      await tx`insert into product_feedback (id, session_hash, client_bucket, request_id, phone_hash, payload_enc, created_at, expires_at)
        values (${id},${digest(session)},${bucket},${requestId},${phoneHash ?? null},${encrypt(JSON.stringify(input))},${now},${new Date(+now + RETENTION_MS)})`;
      return id;
    });
  }

  async list(session: string, now = new Date()): Promise<{ id: string; comment: string; state: string; createdAt: string; improved: boolean | null }[]> {
    const rows = await this.sql`select id,payload_enc,state,created_at,improved from product_feedback
      where session_hash=${digest(session)} and expires_at > ${now} order by created_at desc limit 20`;
    return rows.map(r => ({id:String(r['id']),comment:(JSON.parse(decrypt(String(r['payload_enc']))) as FeedbackInput).comment,
      state:String(r['state']),createdAt:(r['created_at'] as Date).toISOString(),improved:r['improved'] as boolean | null}));
  }

  async remove(session: string, id: string): Promise<void> {
    await this.sql`delete from product_feedback where id=${id} and session_hash=${digest(session)}`;
  }
  async vote(session: string, id: string, improved: boolean): Promise<boolean> {
    const rows = await this.sql`update product_feedback set improved=${improved},updated_at=now()
      where id=${id} and session_hash=${digest(session)} and state='released' and expires_at>now() returning id`;
    return rows.length > 0;
  }
  async read(id: string, now = new Date()): Promise<{ id: string; input: FeedbackInput; state: string; issue: number | null } | undefined> {
    const [row] = await this.sql`select id,payload_enc,state,issue_number from product_feedback where id=${id} and expires_at>${now}`;
    return row ? {id:String(row['id']),input:JSON.parse(decrypt(String(row['payload_enc']))) as FeedbackInput,state:String(row['state']),issue:row['issue_number'] as number | null} : undefined;
  }
  async status(id: string, state: FeedbackState, issue: number, pr?: number): Promise<boolean> {
    if (state==='ready' && !pr) return false;
    const rows = await this.sql`update product_feedback set state=${state},pr_number=coalesce(${pr ?? null},pr_number),updated_at=now()
      where id=${id} and issue_number=${issue} and expires_at>now() and state<>'released'
      and (
        (${state}='reviewing' and state in ('queued','needs_input','reviewing'))
        or (${state} in ('needs_input','ready') and state='reviewing')
        or (${state}='ready' and state='ready' and pr_number=${pr ?? null})
        or (${state}='closed' and state<>'closed')
      ) returning id`;
    return rows.length > 0;
  }
  async prune(now = new Date()): Promise<number> {
    return (await this.sql`delete from product_feedback where expires_at <= ${now} returning id`).length;
  }
}
