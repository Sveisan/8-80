import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
/* global fetch, AbortSignal */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { api, CODE_REPOSITORY, serviceUrl, updateReport } from './contract.mjs';

try {
  const repository=process.env.GITHUB_REPOSITORY??'';
  const issue=Number(process.env.FEEDBACK_ISSUE);
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!Number.isSafeInteger(issue)||issue<1)throw Error();
  const metadata=await api(`/repos/${repository}`,process.env.GITHUB_TOKEN);
  if(metadata.private!==true)throw Error('Feedback automation must run in a private repository');
  const record=await api(`/repos/${repository}/issues/${issue}`,process.env.GITHUB_TOKEN);
  const match=/<!-- product-feedback:([a-f0-9-]{36}) -->/.exec(record.body??'');
  if(!match||record.pull_request||record.state!=='open'||record.user.login!==process.env.FEEDBACK_REPORTER)throw Error('Not an enrolled feedback report');
  const id=match[1];let report;
  for(let i=0;i<5;i++){
    const r=await fetch(`${serviceUrl()}/product-feedback/worker/${id}`,{headers:{authorization:`Bearer ${process.env.FEEDBACK_WORKER_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(15_000)});
    if(r.ok){report=await r.json();break;}if(r.status!==409)throw Error();await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!report||report.issue!==issue||report.id!==id||!['queued','needs_input'].includes(report.state))throw Error('Report is no longer eligible');
  const day=new Date().toISOString().slice(0,10);
  const runs=await api(`/repos/${repository}/actions/workflows/improve.yml/runs?per_page=1&created=${day}..${day}`,process.env.GITHUB_TOKEN);
  if(runs.total_count>5)throw Error('Daily preparation limit reached');
  const source=await api(`/repos/${CODE_REPOSITORY}`,process.env.GITHUB_TOKEN);
  const commit=await api(`/repos/${CODE_REPOSITORY}/commits/${encodeURIComponent(source.default_branch)}`,process.env.GITHUB_TOKEN);
  if(!/^[a-f0-9]{40}$/.test(commit.sha))throw Error();
  mkdirSync('.feedback-private',{recursive:true,mode:0o700});
  const input={...report.input};
  if(input.image){const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[input.image.type];if(!extension)throw Error();writeFileSync(`.feedback-private/screenshot.${extension}`,Buffer.from(input.image.data,'base64'),{mode:0o600});delete input.image;}
  const request={id,issue,input,base:commit.sha,branch:source.default_branch};
  writeFileSync('.feedback-private/request.json',JSON.stringify(request),{mode:0o600});
  await updateReport(request,'reviewing');
  appendFileSync(process.env.GITHUB_OUTPUT,`base=${commit.sha}\nid=${id}\n`);
  console.log('Private report prepared; no customer content was logged.');
} catch { console.error('Feedback report could not be prepared. Check eligibility and connection settings privately.');process.exitCode=1; }
