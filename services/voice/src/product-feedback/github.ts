import type postgres from 'postgres';
import { ticket } from './model.ts';

export interface FeedbackGitHub { repository: string; token: string; }
export function githubConfig(): FeedbackGitHub | undefined {
  const repository = process.env['PRODUCT_FEEDBACK_GITHUB_REPOSITORY'] ?? '';
  const token = process.env['PRODUCT_FEEDBACK_GITHUB_TOKEN'] ?? '';
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) && token ? {repository,token} : undefined;
}

/** A row lock owns a ticket attempt. Ambiguous writes are reconciled, never blindly repeated. */
export async function syncFeedbackIssues(sql: postgres.Sql, settings = githubConfig(), fetcher: typeof fetch = fetch): Promise<number> {
  if (!settings) return 0;
  const headers = {authorization:`Bearer ${settings.token}`,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','content-type':'application/json'};
  const call = (path: string, init: RequestInit = {}) => fetcher(`https://api.github.com/repos/${settings.repository}${path}`, {...init,headers,signal:AbortSignal.timeout(10_000),redirect:'error'});
  const metadata = await call('');
  if (!metadata.ok || (await metadata.json() as {private?:boolean}).private !== true) throw new Error('Feedback tracker must be a private repository');
  let made = 0;
  const candidates = await sql`select id from product_feedback where issue_number is null and expires_at>now()
    and (issue_attempted_at is null or issue_attempted_at<now()-interval '5 minutes') order by created_at limit 5`;
  for (const candidate of candidates) {
    await sql.begin(async tx => {
      const [row] = await tx`select id,issue_attempted_at from product_feedback where id=${candidate['id']} and issue_number is null and expires_at>now() for update skip locked`;
      if (!row) return;
      const id = String(row['id']);
      if (row['issue_attempted_at']) {
        // Use the listing API rather than eventually consistent search. Never create again
        // after an ambiguous result; an operator can reconcile unusually large backlogs.
        const response = await call('/issues?state=all&per_page=100&sort=created&direction=desc');
        if (!response.ok) return;
        const entries = await response.json() as {number:number;body?:string}[];
        const found = entries.filter(x => x.body?.includes(`<!-- product-feedback:${id} -->`));
        if (found.length === 1) await tx`update product_feedback set issue_number=${found[0]!.number},updated_at=now() where id=${id}`;
        return;
      }
      // Commit the intent before the external write, so a crash cannot create a second ticket.
      await tx`update product_feedback set issue_attempted_at=now() where id=${id}`;
    });
    const [claimed] = await sql`update product_feedback set issue_sending=true where id=${candidate['id']} and issue_number is null
      and issue_attempted_at is not null and issue_sending=false returning id`;
    if (!claimed) continue;
    try {
      const response = await call('/issues', {method:'POST',body:JSON.stringify(ticket(String(claimed['id'])))});
      if (!response.ok) continue;
      const result = await response.json() as {number?:number};
      if (!Number.isSafeInteger(result.number) || !result.number || result.number<1) continue;
      await sql`update product_feedback set issue_number=${result.number},updated_at=now() where id=${claimed['id']}`;
      made++;
    } catch { /* The durable attempted/sending flags require reconciliation on the next run. */ }
  }
  return made;
}
