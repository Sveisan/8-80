import{test}from'node:test';import assert from'node:assert/strict';
import{ResendMailer}from'../src/recap/resend.ts';
import type{Recap}from'../src/recap/compose.ts';
test('contractual mail can route replies to the monitored support address without changing the sender',async()=>{
 const before=globalThis.fetch;let sent:Record<string,unknown>|undefined;
 try{globalThis.fetch=async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({id:'synthetic-mail'}));};
 const recap:Recap={subject:'Contract',replyTo:'support@example.com',body:'Contract information',parts:[{role:'body',text:'Contract information'}]};
 await new ResendMailer('synthetic','Business <sender@example.com>').send('recipient@example.com',recap);
 assert.equal(sent?.reply_to,'support@example.com');assert.equal(sent?.from,'Business <sender@example.com>');
 }finally{globalThis.fetch=before;}
});
test('ordinary recap mail retains its existing reply behaviour',async()=>{
 const before=globalThis.fetch;let sent:Record<string,unknown>|undefined;
 try{globalThis.fetch=async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({id:'synthetic-mail'}));};
 await new ResendMailer('synthetic','Business <sender@example.com>').send('recipient@example.com',{subject:'Recap',body:'A recap',parts:[{role:'body',text:'A recap'}]});
 assert.ok(sent&&!Object.hasOwn(sent,'reply_to'));
 }finally{globalThis.fetch=before;}
});
