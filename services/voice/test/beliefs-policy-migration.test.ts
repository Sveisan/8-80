import {test} from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {applyMigrations} from '../src/store/migrate.ts';

test('policy migration preserves populated legacy enrollment, sessions, payment and schedule', {skip:!process.env['TEST_DATABASE_URL']?'Requires the disposable database runner':false}, async()=>{
  const url=process.env['TEST_DATABASE_URL']!;const schema='t_policy_populated_upgrade';
  const folder=await mkdtemp(join(tmpdir(),'beliefs-migration-'));
  const migrations=resolve(import.meta.dirname,'../drizzle');
  const journal=JSON.parse(await readFile(join(migrations,'meta/_journal.json'),'utf8')) as {entries:{tag:string}[]};
  const legacy={...journal,entries:journal.entries.filter(e=>!e.tag.startsWith('0026_'))};
  await mkdir(join(folder,'meta'));await writeFile(join(folder,'meta/_journal.json'),JSON.stringify(legacy));
  for(const entry of legacy.entries)await copyFile(join(migrations,entry.tag+'.sql'),join(folder,entry.tag+'.sql'));
  const sql=postgres(url,{max:1,connection:{search_path:schema},onnotice:()=>{}});
  try{
    await sql.unsafe(`create schema ${schema}`);
    await applyMigrations(url,folder,{connection:{search_path:schema}},schema);
    await sql`insert into callers(phone_hash,phone_enc) values('synthetic-owner','encrypted-number')`;
    await sql`insert into belief_enrollments(phone_hash,practice_enc,consent_version,consent_at,standing,provider,purchase_id,payment_id,daily_minute,next_daily_at)
      values('synthetic-owner','encrypted-practice','beliefs-v1',now(),'active','stripe','cs_original','pi_original',510,'2026-10-16T06:30:00Z')`;
    await sql`insert into call_attempts(id,phone_hash,scheduled_for,status) values('original-attempt','synthetic-owner',now(),'completed')`;
    await sql`insert into belief_sessions(id,phone_hash,kind,snapshot_enc,complete) values('original-attempt','synthetic-owner','daily','encrypted-snapshot',true)`;
    await applyMigrations(url,undefined,{connection:{search_path:schema}},schema);
    const [e]=await sql`select * from belief_enrollments`;const [s]=await sql`select * from belief_sessions`;
    assert.ok(e!['id']);assert.equal(s!['programme_id'],e!['id']);assert.equal(s!['snapshot_enc'],'encrypted-snapshot');
    assert.equal(e!['practice_enc'],'encrypted-practice');assert.equal(e!['purchase_id'],'cs_original');assert.equal(e!['payment_id'],'pi_original');
    assert.equal(e!['checkout_reference'],'beliefs:synthetic-owner');assert.equal(e!['first_connected_at'],null);assert.equal(e!['is_current'],true);
    assert.equal(e!['next_daily_at'].toISOString(),'2026-10-16T06:30:00.000Z');
    await sql`update belief_enrollments set is_current=false`;
    await sql`insert into belief_enrollments(phone_hash,checkout_reference,practice_enc,consent_version,consent_at) values('synthetic-owner','beliefs:new-programme','new-content','beliefs-v2',now())`;
    assert.equal((await sql`select * from belief_enrollments`).length,2);
    assert.equal((await sql`select * from belief_sessions`)[0]!['programme_id'],e!['id']);
  }finally{
    await sql.unsafe(`drop schema if exists ${schema} cascade`);await sql.end({timeout:3});await rm(folder,{recursive:true,force:true});
  }
});
