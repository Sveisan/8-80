import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {weeklyQuality} from '../src/quality/weekly.ts';
import {qualityFixtures} from '../src/quality/fixtures.ts';
import type {CallTranscript} from '../src/call/outcome.ts';

const fixture=(id:string)=>qualityFixtures.find(f=>f.id===id)!;
test('a natural closing without a question is not a failure',()=>{
  const f=fixture('return-natural-close');const report=weeklyQuality(f.transcript,f.context);
  assert.equal(report.structural.stackedQuestionTurnCount,0);assert.equal(report.structural.repeatedQuestionCandidateCount,0);
  assert.equal(report.memory.verbatimPriorCommitmentReference,true);assert.equal(report.humanReview.endingAppropriate,'unrated');
  assert.ok(!JSON.stringify(report).includes('send the draft'));
});
test('stacked questions and question runs remain different review signals',()=>{
  const stacked=weeklyQuality(fixture('stacked-questions').transcript);
  assert.equal(stacked.structural.stackedQuestionTurns[0]!.questions,3);assert.equal(stacked.structural.maxQuestionTurnRun,1);
  const chain=weeklyQuality(fixture('question-chain-needs-listening').transcript);
  assert.equal(chain.structural.stackedQuestionTurnCount,0);assert.equal(chain.structural.maxQuestionTurnRun,4);
  assert.equal(chain.humanReview.repeatedFollowups,'unrated');
});
test('adjacent provider chunks cannot hide stacked questions',()=>{
  const t:CallTranscript={providerCallId:'synthetic',durationMs:1000,turns:[{speaker:'agent',text:'What happened?'},{speaker:'agent',text:'Why was that?'},{speaker:'caller',text:'Let me answer.'}]};
  const report=weeklyQuality(t);assert.equal(report.structural.agentTurns,1);assert.equal(report.structural.stackedQuestionTurns[0]!.questions,2);
});
test('exact repeated questions are candidates; requested repetition still needs a listener',()=>{
  const f=fixture('repeated-question');const report=weeklyQuality(f.transcript);
  assert.deepEqual(report.structural.repeatedQuestionCandidates,[{firstAgentTurn:1,agentTurn:2}]);
  assert.equal(report.humanReview.followupRelevance,'unrated');
});
test('missing pre-call memory is unknown, not a fabricated memory failure',()=>{
  const t=fixture('return-natural-close').transcript;
  assert.equal(weeklyQuality(t).memory.priorContext,'unknown');assert.equal(weeklyQuality(t).memory.verbatimPriorCommitmentReference,null);
  assert.equal(weeklyQuality(t,{kind:'return',priorCommitment:'(nothing recorded)'}).memory.priorContext,'none');
  assert.equal(weeklyQuality(t,{kind:'return',priorCommitment:'different action'}).memory.verbatimPriorCommitmentReference,false);
});
test('reports contain no caller wording or opaque identifiers, and cannot infer audio quality',()=>{
  const privateWords='Private synthetic example +4791234567 private@example.test';
  const t:CallTranscript={providerCallId:'private_conversation',durationMs:1000,turns:[{speaker:'agent',text:privateWords+'?'},{speaker:'caller',text:privateWords}]};
  const report=weeklyQuality(t,{kind:'return',priorCommitment:privateWords});const json=JSON.stringify(report);
  for(const value of [privateWords,'private_conversation','91234567','example.test'])assert.ok(!json.includes(value));
  assert.equal(report.humanReview.interruptions,'requires_audio_or_timing');assert.equal(report.humanReview.responseLatency,'requires_audio_or_timing');
});
test('long utterances produce bounded review indices, not copied passages',()=>{
  const text=('synthetic '.repeat(100))+'What happened?';
  const t:CallTranscript={providerCallId:'synthetic',durationMs:1000,turns:Array.from({length:120},(_,i)=>({speaker:i%2===0?'agent':'caller',text}))};
  const report=weeklyQuality(t);assert.equal(report.structural.longAgentTurnCount,60);assert.equal(report.structural.longAgentTurns.length,50);
  assert.throws(()=>weeklyQuality({...t,turns:Array.from({length:10001},()=>({speaker:'agent',text:'x'}))}));
});
const cli=resolve(import.meta.dirname,'../src/quality/cli.ts');
const run=(args:string[])=>spawnSync(process.execPath,['--import','tsx',cli,...args],{encoding:'utf8',timeout:15000,env:{...process.env,DATABASE_URL:'postgres://invalid:invalid@127.0.0.1:1/no_database',SPEECHIFY_API_KEY:'synthetic-secret-never-output'}});
test('the default baseline needs no database or provider credentials',()=>{
  const r=run([]);assert.equal(r.status,0,r.stderr);const parsed=JSON.parse(r.stdout);
  assert.equal(parsed.source,'synthetic_only');assert.equal(parsed.cases.length,6);assert.ok(!r.stdout.includes('synthetic-secret-never-output'));
});
test('private file review prints signals only and malformed source never leaks diagnostics',()=>{
  const dir=mkdtempSync(join(tmpdir(),'8and80-quality-'));
  try{
    const file=join(dir,'private.json');const f=fixture('return-natural-close');
    writeFileSync(file,JSON.stringify({conversation_id:'private-id',duration_ms:1000,messages:f.transcript.turns.map(t=>({role:t.speaker,content:t.text}))}));
    const ok=run(['--file',file]);assert.equal(ok.status,0,ok.stderr);assert.ok(!ok.stdout.includes('send the draft'));assert.equal(JSON.parse(ok.stdout).report.memory.priorContext,'unknown');
    writeFileSync(file,'private-secret-sentence-is-not-json');const bad=run(['--file',file]);assert.equal(bad.status,1);
    assert.ok(!bad.stderr.includes('private-secret-sentence'));assert.ok(!bad.stderr.includes(file));assert.ok(!bad.stderr.includes('synthetic-secret'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
