import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,chmodSync,readdirSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const source=readFileSync(resolve(import.meta.dirname,'../../../scripts/update-safe.sh'),'utf8');
const branch='claude/8-80-prompt-v3-f9tk4m';
const secret='synthetic-private-diagnostic-never-share';
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'8and80-update-')),bin=join(dir,'bin'),repo=join(dir,'checkout'),seed=join(dir,'seed'),backup=join(dir,'backups');
  mkdirSync(bin);mkdirSync(seed);
  const env={...process.env,PATH:bin+':'+process.env['PATH'],FIXTURE:dir,PRIVATE_MARKER:secret,GIT_ALLOW_PROTOCOL:'file',GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.test',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.test'};
  const git=(cwd:string,...args:string[])=>{const r=spawnSync('git',args,{cwd,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git(seed,'init','-b',branch);writeFileSync(join(seed,'.gitignore'),'.env\n');writeFileSync(join(seed,'old.txt'),'old');
  git(seed,'add','.');git(seed,'commit','-m','base');
  git(dir,'clone','--bare',seed,join(dir,'origin.git'));git(dir,'clone',join(dir,'origin.git'),repo);
  git(seed,'remote','add','origin',join(dir,'origin.git'));
  mkdirSync(join(seed,'services/voice/src'),{recursive:true});writeFileSync(join(seed,'services/voice/src/server.ts'),'// new source\n');
  git(seed,'add','.');git(seed,'commit','-m','release');const target=git(seed,'rev-parse','HEAD');git(seed,'push','origin',branch);
  // A newer remote commit must not silently replace the explicitly requested release.
  writeFileSync(join(seed,'unreviewed.txt'),'later');git(seed,'add','.');git(seed,'commit','-m','later');git(seed,'push','origin',branch);
  writeFileSync(join(repo,'.env'),secret,{mode:0o600});writeFileSync(join(dir,'web'),'active');
  const stub=(name:string,body:string)=>{const path=join(bin,name);writeFileSync(path,'#!/usr/bin/env bash\nset -eu\n'+body+'\n',{mode:0o755});chmodSync(path,0o755);};
  stub('sudo',`[[ $1 == -u ]]; user=$2; shift 2
printf '%s\\n' "$user $*" >>"$FIXTURE/commands"
printf '%s\\n' "$PRIVATE_MARKER" >&2
exec "$@"`);
  stub('pg_dump',`printf '%s\\n' "$PRIVATE_MARKER"`);
  stub('npm',`[[ $(umask) == 0022 ]]
printf '%s\\n' "$PRIVATE_MARKER"
[[ \${FAIL_NPM:-0} != 1 ]]`);
  stub('flock','exit 0');
  stub('systemctl',`cmd=$1; unit=\${@: -1}; printf '%s\\n' "$cmd $unit" >>"$FIXTURE/services"
case "$cmd" in
is-active) if [[ $unit == 8and80-control.service ]]; then test -f "$FIXTURE/web"; else test -f "$FIXTURE/timer"; fi;;
stop) rm -f "$FIXTURE/web" "$FIXTURE/timer";;
start) if [[ $unit == 8and80-control.service ]]; then touch "$FIXTURE/web"; else touch "$FIXTURE/timer"; fi;;
enable) touch "$FIXTURE/timer";;
esac`);
  stub('curl',`while [[ $# -gt 0 ]]; do if [[ $1 == --output ]]; then printf '{"ok":true}' >"$2"; shift; fi; shift; done
printf '%s\\n' "$PRIVATE_MARKER"`);
  // Exercise the real script body with fixture paths and simulated privilege
  // entry only. sudo/systemd are stubs; Git checkout and file modes are real.
  const script=join(dir,'update.sh');
  writeFileSync(script,source.replace('$EUID -ne 0','0 -ne 0').replace('REPO=/opt/8-80',`REPO=${repo}`).replaceAll('/var/backups/8and80',backup).replace('/run/lock/8and80-update.lock',join(dir,'lock')));
  return {dir,repo,backup,env,git,target,run:(extraEnv:Record<string,string>={},flags:string[]=[])=>spawnSync('bash',[script,target,...flags],{env:{...env,...extraEnv},encoding:'utf8',timeout:20000}),close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('private backups stay private while new source stays readable and the requested commit is deployed',()=>{
  const f=fixture();try{
    const r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(!r.stdout.includes(secret));assert.ok(!r.stderr.includes(secret));
    assert.equal(f.git(f.repo,'rev-parse','HEAD'),f.target);
    assert.equal(statSync(join(f.repo,'services/voice/src/server.ts')).mode&0o777,0o644);
    assert.equal(statSync(join(f.repo,'services/voice/src')).mode&0o777,0o755);
    assert.equal(statSync(join(f.repo,'.env')).mode&0o777,0o600);
    const runDir=join(f.backup,readdirSync(f.backup)[0]!);
    assert.equal(statSync(runDir).mode&0o777,0o700);
    for(const name of ['private.log','database.dump','env','previous-commit'])assert.equal(statSync(join(runDir,name)).mode&0o777,0o600);
    assert.match(r.stdout,/Web: ACTIVE/);assert.match(r.stdout,/Scheduled calls: PAUSED/);
    assert.ok(readFileSync(join(f.dir,'commands'),'utf8').split('\n').filter(x=>x.includes('git ')).every(x=>x.startsWith('eightandeighty ')));
  }finally{f.close();}
});
test('a git status error cannot masquerade as a clean checkout or stop services',()=>{
  const f=fixture();try{
    // Broken Git metadata produces a genuine status failure, not an empty status.
    rmSync(join(f.repo,'.git'),{recursive:true,force:true});
    const r=f.run();assert.notEqual(r.status,0);assert.match(r.stdout,/FAILED: checking merged release and clean checkout/);
    assert.doesNotMatch(readFileSync(join(f.dir,'services'),'utf8'),/^stop /m);
    assert.ok(!r.stdout.includes(secret));assert.ok(!r.stderr.includes(secret));
  }finally{f.close();}
});
test('a failed dependency install leaves scheduling paused and reports web failure without diagnostic leakage',()=>{
  const f=fixture();try{
    const r=f.run({FAIL_NPM:'1'});assert.notEqual(r.status,0);assert.match(r.stdout,/FAILED: installing dependencies/);
    assert.match(r.stdout,/Web: NOT ACTIVE/);assert.match(r.stdout,/Scheduled calls: PAUSED/);
    assert.ok(!r.stdout.includes(secret));assert.ok(!r.stderr.includes(secret));
  }finally{f.close();}
});
