import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { decrypt, encrypt } from '../store/crypto.ts';

type Row = { last_commitment_enc: string | null; last_commitment_day: string | null; goals_enc: string | null };
const revisionOf = (row: Row): string => createHash('sha256').update(JSON.stringify(row)).digest('hex');
const open = (row: Row) => ({
  commitment: row.last_commitment_enc ? decrypt(row.last_commitment_enc) : '',
  goals: row.goals_enc ? decrypt(row.goals_enc) : '',
  revision: revisionOf(row),
});
export type Memory = ReturnType<typeof open>;
export async function readMemory(sql: postgres.Sql, hash: string): Promise<Memory | undefined> {
  const [row] = await sql<Row[]>`select last_commitment_enc, last_commitment_day, goals_enc from callers where phone_hash = ${hash}`;
  return row ? open(row) : undefined;
}
export async function correctMemory(sql: postgres.Sql, hash: string, revision: string, commitment: string, goals: string): Promise<'saved' | 'changed' | 'missing'> {
  return await sql.begin(async tx => {
    const [row] = await tx<Row[]>`select last_commitment_enc, last_commitment_day, goals_enc from callers where phone_hash = ${hash} for update`;
    if (!row) return 'missing' as const;
    if (revisionOf(row) !== revision) return 'changed' as const;
    const before = open(row);
    await tx`update callers set last_commitment_enc = ${commitment ? encrypt(commitment) : null},
      last_commitment_day = ${before.commitment === commitment ? row.last_commitment_day : null},
      goals_enc = ${goals ? encrypt(goals) : null}, updated_at = now() where phone_hash = ${hash}`;
    return 'saved' as const;
  });
}
