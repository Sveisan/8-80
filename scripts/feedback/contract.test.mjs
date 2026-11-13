import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialize, validatePatch, parseResult } from './contract.mjs';

const ui='services/voice/src/signup/page.ts', regression='services/voice/test/feedback-regression-1234abcd.test.ts';
const diff=(path,added='export const visible = true;')=>`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-export const visible = false;\n+${added}\n`;
const newTest=`diff --git a/${regression} b/${regression}\nnew file mode 100644\n--- /dev/null\n+++ b/${regression}\n@@ -0,0 +1 @@\n+export const syntheticRegression = true;\n`;
const request={input:{comment:'The synthetic private report has a long sentence that must never appear verbatim in public source.',page:'/me'}};
test('policy refuses protected files, executable files, networking, private content and weakened checks',()=>{
  const patch=diff(ui)+newTest;assert.deepEqual(validatePatch(patch,request),[ui,regression]);
  for(const candidate of [diff('services/voice/src/control.ts')+newTest,patch.replace('100644','100755'),diff(ui,'fetch("/send")')+newTest,
    diff(ui,request.input.comment)+newTest,diff(ui,'const contact="person@example.com";')+newTest]) {
    const r=candidate.includes('person@example.com')?{input:{comment:'Contact person@example.com'}}:request;
    assert.throws(()=>validatePatch(candidate,r));
  }
  assert.throws(()=>validatePatch(diff(ui)+diff(regression),request));
  assert.throws(()=>parseResult('{"status":"ready","patch":4,"summary":"x"}'));
});
test('materialization applies exactly the screened files and refuses conflicting patch headers',()=>{
  const cwd=mkdtempSync(join(tmpdir(),'8and80-patch-'));
  const git=(...args)=>execFileSync('git',args,{cwd,stdio:'pipe'});
  try {
    mkdirSync(join(cwd,'services/voice/src/signup'),{recursive:true});mkdirSync(join(cwd,'services/voice/test'),{recursive:true});
    writeFileSync(join(cwd,ui),'export const visible = false;\n');
    git('init','-q');git('add','.');git('-c','user.name=Synthetic','-c','user.email=synthetic@example.com','commit','-qm','Fixture');
    const raw=JSON.stringify({status:'ready',summary:'Synthetic interface fix',patch:diff(ui)+newTest});
    assert.deepEqual(materialize(raw,request,cwd).paths,[ui,regression]);
    assert.equal(readFileSync(join(cwd,ui),'utf8'),'export const visible = true;\n');
    git('reset','--hard','HEAD');rmSync(join(cwd,regression));
    const deceptive=diff(ui).replace(`--- a/${ui}`, '--- a/services/voice/src/control.ts').replace(`+++ b/${ui}`,'+++ b/services/voice/src/control.ts')+newTest;
    assert.throws(()=>materialize(JSON.stringify({status:'ready',summary:'Synthetic',patch:deceptive}),request,cwd));
  } finally {rmSync(cwd,{recursive:true,force:true});}
});
