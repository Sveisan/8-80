import{test}from'node:test';import assert from'node:assert/strict';
import{withdrawalDeadline,consumerDeadline,consumerCallsAllowed,CONSUMER_TERMS_VERSION}from'../src/unblock/consumer-policy.ts';
test('withdrawal counts fourteen Oslo dates and extends weekends and Norwegian public holidays',()=>{
 assert.equal(withdrawalDeadline(new Date('2026-11-07T10:00:00Z')).toISOString(),'2026-11-23T22:59:59.999Z');
 assert.equal(withdrawalDeadline(new Date('2026-12-18T10:00:00Z')).toISOString(),'2027-01-04T22:59:59.999Z');
 assert.equal(withdrawalDeadline(new Date('2026-03-20T10:00:00Z')).toISOString(),'2026-04-07T21:59:59.999Z');
});
test('missing information extends the recorded deadline; late delivery never shortens it',()=>{
 const e={contract_at:new Date('2026-11-10T10:00:00Z')};
 assert.equal(consumerDeadline(e)?.toISOString(),'2027-11-24T22:59:59.999Z');
 assert.equal(consumerDeadline({...e,information_delivered_at:new Date('2026-11-15T10:00:00Z')})?.toISOString(),'2026-11-30T22:59:59.999Z');
});
test('early calls require explicit choice, durable information and no withdrawal, independently of payment standing',()=>{
 const at=new Date('2026-11-10T10:00:00Z'),e={contract_subscription_id:'sub_test',terms_version:CONSUMER_TERMS_VERSION,contract_at:at,information_delivered_at:at};
 assert.equal(consumerCallsAllowed({...e,subscription_id:'sub_other',early_start_at:at},at),false);
 assert.equal(consumerCallsAllowed(e,at),false);assert.equal(consumerCallsAllowed({...e,early_start_at:at},at),true);
 assert.equal(consumerCallsAllowed({...e,early_start_at:at,information_delivered_at:null},at),false);
 assert.equal(consumerCallsAllowed({...e,early_start_at:at,withdraw_requested_at:at},new Date('2027-01-01')),false);
 assert.equal(consumerCallsAllowed(e,new Date('2026-11-25T00:00:00Z')),true);assert.equal(consumerCallsAllowed({...e,terms_version:null},new Date('2027-01-01')),false);
});
