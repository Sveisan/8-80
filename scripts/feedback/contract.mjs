import process from 'node:process';
import { Buffer } from 'node:buffer';
/* global fetch, AbortSignal, URL */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

export const CODE_REPOSITORY = 'Sveisan/8-80';
export const MAX_PATCH = 60_000;
export const UI_FILES = new Set([
  'services/voice/src/signup/page.ts',
  'services/voice/src/link/page.ts',
  'services/voice/src/design-system/pages.ts',
  'services/voice/src/design-system/styles.ts',
  'services/voice/src/feedback/page.ts',
  'services/voice/src/product-feedback/widget.ts',
]);
export const testFile = path => /^services\/voice\/test\/feedback-regression-[a-f0-9]{8}\.test\.ts$/.test(path);
export const allowedFile = path => UI_FILES.has(path) || testFile(path);
export function parseResult(raw) {
  const result=JSON.parse(raw);
  if (!result || !['ready','needs_input'].includes(result.status) || typeof result.patch!=='string' || typeof result.summary!=='string'
    || result.summary.length>1500 || Buffer.byteLength(result.patch)>MAX_PATCH) throw Error('Invalid agent result');
  return result;
}
export function validatePatch(patch, request) {
  if (!patch || Buffer.byteLength(patch)>MAX_PATCH || /GIT binary patch|Binary files |^(?:deleted file|old mode|new mode|rename from|rename to)|new file mode (?!100644)/m.test(patch)) throw Error('Unsupported patch');
  const paths=[...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map(m=>{if(m[1]!==m[2] || !allowedFile(m[1]))throw Error('Change needs a person');return m[1];});
  if (!paths.length || paths.length>10 || new Set(paths).size!==paths.length || !paths.some(p=>UI_FILES.has(p)) || !paths.some(testFile)) throw Error('Missing focused change or regression check');
  const added=patch.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).map(l=>l.slice(1)).join('\n');
  // Network, process and data access restrictions apply to production and tests.
  if (/process\s*\.|child_process|node:fs|readFile|writeFile|\beval\s*\(|new\s+Function|https?:\/\/|XMLHttpRequest|sendBeacon|\bfetch\s*\(/i.test(added)) throw Error('Change exceeds automatic preparation scope');
  const compact=s=>s.replace(/\s+/g,' ').trim();
  const comment=compact(String(request?.input?.comment ?? ''));
  const publicText=compact(added);
  for(let i=0;comment.length>=40&&i<=comment.length-40;i+=10) if(publicText.includes(comment.slice(i,i+40)))throw Error('Private feedback copied into patch');
  const privateValues=comment.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+\d[\d ()-]{7,}\d|(?:Bearer\s+)[\w.-]+/gi)??[];
  if(privateValues.some(v=>added.includes(v)))throw Error('Private value copied into patch');
  for(const section of patch.split(/^diff --git /m).slice(1)) {
    const path=/^a\/(\S+)/.exec(section)?.[1];
    // Test-only image/element mocks need callback fields. Production additions
    // still require explicit review; the test exception grants no network access.
    const sectionAdded=section.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).join('\n');
    if(path&&UI_FILES.has(path)&&/on(?:load|error|click)\s*=/i.test(sectionAdded))throw Error('Change exceeds automatic preparation scope');
    if(path&&testFile(path)&&section.split('\n').some(l=>l.startsWith('-')&&!l.startsWith('---')))throw Error('Existing regression checks cannot be weakened');
  }
  return paths;
}
export function materialize(raw, request, cwd=process.cwd()) {
  const result=parseResult(raw);
  if(result.status!=='ready')return {result,paths:[]};
  const paths=validatePatch(result.patch,request);
  mkdirSync(`${cwd}/output`,{recursive:true});
  const file=`${cwd}/output/feedback.patch`;
  writeFileSync(file,result.patch,{mode:0o600});
  const actual=execFileSync('git',['apply','--numstat',file],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim().split('\n').map(line=>line.split('\t')[2]);
  if(actual.length!==paths.length || actual.some(path=>!paths.includes(path)))throw Error('Patch paths do not match policy');
  execFileSync('git',['apply','--check','--whitespace=error',file],{cwd,stdio:'pipe'});
  execFileSync('git',['apply','--whitespace=error',file],{cwd,stdio:'pipe'});
  return {result,paths};
}
export function readRequest(){return JSON.parse(readFileSync('.feedback-private/request.json','utf8'));}
export function clearPrivate(){rmSync('.feedback-private',{recursive:true,force:true});}
export async function api(path, token, init={}) {
  const response=await fetch(`https://api.github.com${path}`,{...init,headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw Error('GitHub operation unavailable');
  return response.status===204?undefined:response.json();
}
export function serviceUrl() {
  const url=new URL(process.env.FEEDBACK_SERVICE_URL??'');
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Invalid feedback service origin');
  return url.origin;
}
export async function updateReport(request,state,pr) {
  const response=await fetch(`${serviceUrl()}/product-feedback/worker/${request.id}`,{method:'POST',headers:{authorization:`Bearer ${process.env.FEEDBACK_WORKER_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({state,issue:request.issue,...(pr?{pr}:{})}),redirect:'error',signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw Error('Private report status update unavailable');
}
