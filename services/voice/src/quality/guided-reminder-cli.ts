import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { repoRoot } from '../config.ts';
import { nativeDialoguePlan } from './dialogue-native-plan.ts';
import { normalizeNativeDialogueRun } from './dialogue-native.ts';
import { dialogueBatchReport } from './dialogue-reply.ts';
import { guidedReminderCases, guidedReminderNativePlan, guidedReminderRunReport } from './guided-reminder.ts';

try {
  const [mode,path]=process.argv.slice(2);
  if(!['--plan','--review'].includes(mode??'')||!path||process.argv.length!==4)throw new Error('Use plan or review.');
  const git=(...args:string[])=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(git('status','--porcelain'))throw new Error('Commit source before exporting or reviewing.');
  const source=git('rev-parse','HEAD'),plan={version:1,sourceCommit:source,normal:nativeDialoguePlan(source),guided:guidedReminderNativePlan(source)};
  const serialized=JSON.stringify(plan,null,2),sha=createHash('sha256').update(serialized).digest('hex');
  if(mode==='--plan'){
    writeFileSync(path,serialized,{mode:0o600,flag:'wx'});
    process.stdout.write(JSON.stringify({sourceCommit:source,candidateSha256:sha,normal:plan.normal.definitions.length,guided:plan.guided.definitions.length,phoneCallsPlaced:0})+'\n');
  }else{
    if(statSync(path).size>4_000_000)throw new Error('Oversized review input.');
    const raw=JSON.parse(readFileSync(path,'utf8')) as {sourceCommit?:unknown;candidateSha256?:unknown;normal?:{role:string;case:string;run:unknown}[];guided?:{case:string;run:unknown}[]};
    if(raw.sourceCommit!==source||raw.candidateSha256!==sha||!Array.isArray(raw.normal)||!Array.isArray(raw.guided))throw new Error('Stale or incomplete review.');
    const normal=dialogueBatchReport(raw.normal.map(r=>normalizeNativeDialogueRun(r.role,r.case,r.run)));
    const rows=raw.guided.map(r=>guidedReminderRunReport(r.case,r.run));
    const complete=rows.length===guidedReminderCases.length&&guidedReminderCases.every(c=>rows.filter(r=>r.case===c.id).length===1);
    const guided={total:rows.length,passed:rows.filter(r=>r.passed).length,complete,failures:rows.filter(r=>!r.passed)};
    const report={sourceCommit:source,candidateSha256:sha,normal,guided,approvedForPhonePilot:normal.approvedForPhonePilot&&complete&&rows.every(r=>r.passed),approvedForGlobalActivation:false,voiceVerification:'required'};
    process.stdout.write(JSON.stringify(report)+'\n');if(!report.approvedForPhonePilot)process.exitCode=1;
  }
}catch{
  process.stderr.write('Guided pilot plan or review could not be completed. Check the source revision and private input. No raw contents were printed.\n');process.exitCode=1;
}
