import type postgres from 'postgres';

/** The one weekly call behind a provider conversation id. Beliefs and Unblock calls are other modules' and are never returned. */
export async function weeklyAttempt(sql: postgres.Sql, providerCallId: string): Promise<{ id: string } | undefined> {
  const rows = await sql<{ id: string; other: string | null }[]>`select a.id, coalesce(s.id, u.id) as other from call_attempts a
    left join belief_sessions s on s.id = a.id left join unblock_sessions u on u.id = a.id where a.provider_call_id = ${providerCallId}`;
  return rows.length === 1 && !rows[0]!.other ? { id: rows[0]!.id } : undefined;
}
