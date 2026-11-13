import type postgres from 'postgres';

/** A merged PR is not evidence of deployment. The caller must first verify the live health SHA. */
export async function reconcileReleased(sql: postgres.Sql, liveSHA: string, ancestor: (sha:string,head:string)=>boolean, fetcher:typeof fetch=fetch): Promise<number> {
  if (!/^[a-f0-9]{40}$/.test(liveSHA)) throw Error('A verified live release is required');
  let changed=0;
  const rows=await sql`select id,pr_number from product_feedback where state='ready' and pr_number is not null and expires_at>now() limit 30`;
  for(const row of rows) {
    const response=await fetcher(`https://api.github.com/repos/Sveisan/8-80/pulls/${row['pr_number']}`,{headers:{accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10_000)});
    if(!response.ok)throw Error('Release reconciliation unavailable');
    const pr=await response.json() as {merged?:boolean;merge_commit_sha?:string;head?:{ref?:string};body?:string};
    const sha=pr.merge_commit_sha;
    if(pr.merged!==true || !sha || !/^[a-f0-9]{40}$/.test(sha) || pr.head?.ref!==`codex/feedback-${row['id']}`
      || !pr.body?.includes(`<!-- product-feedback:${row['id']} -->`) || !ancestor(sha,liveSHA))continue;
    changed+=(await sql`update product_feedback set state='released',updated_at=now() where id=${row['id']} and state='ready' returning id`).length;
  }
  return changed;
}
