import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResendMailer } from '../src/recap/resend.ts';
import { TwilioSms } from '../src/sms/twilio.ts';
import { SendFailure } from '../src/messages/types.ts';

test('email requests carry the stable key, require a receipt, and distinguish acceptance from delivery', async () => {
  const original=globalThis.fetch; let state='sent';
  globalThis.fetch=async (_url, init) => {
    if(init?.method==='POST') { assert.equal((init.headers as Record<string,string>)['Idempotency-Key'],'stable-event'); return Response.json({id:'receipt'}); }
    return Response.json({last_event:state});
  };
  try {
    const mail=new ResendMailer('test','test@example.com');
    assert.deepEqual(await mail.send('recipient@example.com',{subject:'Test',body:'Text',parts:[]},{idempotencyKey:'stable-event'}),{id:'receipt'});
    assert.equal(await mail.deliveryStatus('receipt'),'pending');
    state='delivered'; assert.equal(await mail.deliveryStatus('receipt'),'delivered');
    state='bounced'; assert.equal(await mail.deliveryStatus('receipt'),'failed');
    globalThis.fetch=async () => Response.json({}, {status:429});
    await assert.rejects(mail.send('recipient@example.com',{subject:'Test',body:'Text',parts:[]}), (error:unknown)=>error instanceof SendFailure && error.disposition==='retry');
  } finally {globalThis.fetch=original;}
});

test('SMS retries a definitive rate refusal but holds ambiguous server errors and missing receipts', async () => {
  const original=globalThis.fetch; const sms=new TwilioSms('ACtest','test','+4796000000');
  try {
    for(const [status,disposition] of [[429,'retry'],[500,'uncertain'],[400,'permanent'],[200,'uncertain']] as const) {
      globalThis.fetch=async () => Response.json({}, {status});
      await assert.rejects(sms.send('+4796000001','Test'),(error:unknown)=>error instanceof SendFailure && error.disposition===disposition);
    }
    globalThis.fetch=async () => Response.json({sid:'SMreceipt'});
    assert.deepEqual(await sms.send('+4796000001','Test'),{id:'SMreceipt'});
    globalThis.fetch=async () => Response.json({status:'queued'}); assert.equal(await sms.deliveryStatus('SMreceipt'),'pending');
    globalThis.fetch=async () => Response.json({status:'delivered'}); assert.equal(await sms.deliveryStatus('SMreceipt'),'delivered');
  } finally {globalThis.fetch=original;}
});
