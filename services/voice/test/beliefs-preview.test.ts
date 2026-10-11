import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { previewServer } from '../src/beliefs/preview.ts';
import { withinCoverage, coverageReady } from '../src/beliefs/coverage.ts';
import { beliefReadiness } from '../src/beliefs/readiness.ts';
test('preview completes the journey locally, enforces CSRF, and retires without activating unprepared backlog',async()=>{
  const server=previewServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;let cookie='';let html='';
  const hidden=(name:string):string=>{const result=html.match(new RegExp('name="'+name+'" value="([^"<>]*)"'))?.[1];assert.notEqual(result,undefined);return result!;};
  const get=async(path:string)=>{const response=await fetch(base+path,{headers:{cookie},redirect:'manual'});cookie=response.headers.get('set-cookie')?.split(';')[0]??cookie;html=await response.text();return response;};
  const post=async(path:string,fields:Record<string,string>)=>{
    const response=await fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:hidden('csrf'),event:hidden('event'),revision:hidden('revision'),...fields}),redirect:'manual'});
    cookie=response.headers.get('set-cookie')?.split(';')[0]??cookie;
    html=await response.text();if(response.status===303)await get(response.headers.get('location')!);return response;
  };
  try{
    await get('/beliefs/join');
    const rejected=await fetch(base+'/beliefs/join',{method:'POST',headers:{cookie},body:new URLSearchParams({csrf:'bad',phone:'+4791000008',consent:'yes'}),redirect:'manual'});assert.equal(rejected.status,403);
    await post('/beliefs/join',{phone:'+4791000008',name:'Synthetic tester',consent:'yes'});
    assert.ok(html.includes('000000'));
    await post('/beliefs/verify',{code:'000000'});assert.ok(html.includes('Make room for what matters'));
    await post('/beliefs/action',{action:'schedule',timezone:'Europe/Oslo',daily:'08:30',weekly:'17:30',weekday:'0',onboarding:new Date(Date.now()+86400_000).toISOString()});
    await post('/beliefs/action',{action:'pay'});assert.ok(html.includes('One payment, no renewal'));
    await get('/beliefs/onboarding');await post('/beliefs/action',{action:'outcome',outcome:'Synthetic outcome'});
    for(let i=0;i<3;i++)await post('/beliefs/action',{action:'queue',belief:'Synthetic thought '+i,trigger:'Synthetic trigger'});
    await get('/beliefs/prepare');
    for(let i=0;i<2;i++)await post('/beliefs/action',{action:'prepare',id:hidden('id'),decision:'Synthetic decision '+i,evidence:'Synthetic evidence',balance:'Synthetic difficulty',opportunity:'Synthetic step',confirmed:'yes'});
    assert.ok(html.includes('Your selected decisions are ready.'));
    await post('/beliefs/action',{action:'understood',confirmed:'yes'});assert.ok(html.includes('Try a daily check-in'));assert.ok(!html.includes('YOUR NEXT CALL Sunday 11'));
    await get('/beliefs/daily');await post('/beliefs/action',{action:'practice',id:hidden('id'),evidence:'New synthetic evidence',balance:'Still uncertain'});
    await get('/beliefs/weekly');
    const first=hidden('id');await post('/beliefs/action',{action:'review',id:first,score:'1',reflection:'Synthetic progress',confirmed:'yes'});
    await post('/beliefs/action',{action:'nextweek'});
    await post('/beliefs/action',{action:'review',id:first,score:'0',reflection:'Synthetic progress continues',confirmed:'yes'});
    assert.ok(html.includes('ready to prepare'));assert.ok(html.includes('Synthetic thought 2'));assert.equal((html.match(/class="decision">Synthetic decision/g)??[]).length,1);
    await post('/beliefs/action',{action:'pause'});assert.ok(html.includes('Your belief calls are paused'));assert.ok(!html.includes('Your next call</span>'));
    await post('/beliefs/action',{action:'resume'});assert.ok(html.includes('Try a daily check-in'));
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('human coverage window handles Oslo time, overnight cover and invalid configuration',()=>{
  const saved={...process.env};
  try{
    process.env['BELIEFS_COVERAGE_START']='08:00';process.env['BELIEFS_COVERAGE_END']='20:00';
    assert.equal(coverageReady(),true);assert.equal(withinCoverage(new Date('2026-10-10T10:00:00Z')),true);assert.equal(withinCoverage(new Date('2026-10-10T22:00:00Z')),false);
    process.env['BELIEFS_COVERAGE_START']='20:00';process.env['BELIEFS_COVERAGE_END']='08:00';
    assert.equal(withinCoverage(new Date('2026-10-10T22:00:00Z')),true);
    process.env['BELIEFS_COVERAGE_END']='invalid';assert.equal(coverageReady(),false);assert.ok(beliefReadiness().length>0);
  }finally{process.env=saved;}
});
