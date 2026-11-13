import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { config, repoRoot } from '../config.ts';
import { enabled } from './model.ts';
import { githubConfig, syncFeedbackIssues } from './github.ts';
import { runningRelease } from './release.ts';
import { reconcileReleased } from './reconcile.ts';

const command=process.argv[2]??'doctor';
if(command==='doctor') {
  console.log(JSON.stringify({enabled:enabled(),encrypted:Buffer.from(process.env['DATA_ENCRYPTION_KEY']??'','base64').length===32,
    privateTrackerConfigured:Boolean(githubConfig()),workerConfigured:(process.env['PRODUCT_FEEDBACK_WORKER_TOKEN']??'').length>=32,
    releaseKnown:Boolean(runningRelease),manualRelease:true},null,2));
} else {
  const url=process.env['DATABASE_URL']??config.database.url;
  if(!url)throw Error('DATABASE_URL is required');
  const sql=postgres(url,{max:1});
  try {
    if(command==='sync')console.log(`Created ${await syncFeedbackIssues(sql)} private tracking tickets.`);
    else if(command==='metrics')console.log(JSON.stringify(await sql`select state,count(*)::int as reports,count(*) filter(where improved=true)::int as helped,count(*) filter(where improved=false)::int as not_yet from product_feedback where expires_at>now() group by state`,null,2));
    else if(command==='reconcile-release') {
      const origin=new URL(config.link.publicUrl());
      if(origin.protocol!=='https:'||!runningRelease)throw Error('A known production checkout and HTTPS origin are required');
      const response=await fetch(new URL('/health',origin),{redirect:'error',signal:AbortSignal.timeout(10_000)});
      const health=await response.json() as {ok?:boolean;release?:string};
      if(!response.ok||health.ok!==true||health.release!==runningRelease)throw Error('Live web process does not match this checkout; nothing marked released');
      const ancestor=(sha:string,head:string):boolean=>{try{execFileSync('git',['merge-base','--is-ancestor',sha,head],{cwd:repoRoot,stdio:'ignore'});return true;}catch{return false;}};
      console.log(`Marked ${await reconcileReleased(sql,runningRelease,ancestor)} deployed changes released.`);
    } else throw Error('Use doctor, sync, metrics or reconcile-release');
  } finally {await sql.end({timeout:3});}
}
