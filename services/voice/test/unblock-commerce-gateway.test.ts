import{test}from'node:test';import assert from'node:assert/strict';
import{unblockCommerceGateway}from'../src/unblock/commerce-gateway.ts';
function fixture(over:Record<string,unknown>={}){
 process.env['STRIPE_SECRET_KEY']='synthetic-private-test-key';
 const base:Record<string,unknown>={
  '/subscriptions/sub_test':{id:'sub_test',customer:'cus_test',created:1794304800},
  '/invoices?subscription=sub_test&limit=100':{has_more:false,data:[{id:'in_first',billing_reason:'subscription_create'},{id:'in_later',billing_reason:'subscription_cycle'}]},
  '/invoices/in_first':{id:'in_first',parent:{subscription_details:{subscription:'sub_test'}},customer:'cus_test',status:'paid',amount_paid:24900,currency:'nok',status_transitions:{paid_at:1794304860},lines:{has_more:false,data:[{pricing:{price_details:{price:'price_test'}}}]}},
  '/prices/price_test':{id:'price_test',product:'prod_test'},
  '/invoice_payments?invoice=in_first&limit=100':{has_more:false,data:[{status:'paid',payment:{payment_intent:'pi_test'}}]},
  '/refunds/re_test':{id:'re_test',payment_intent:'pi_test',amount:24900,currency:'nok',status:'succeeded'},
  ...over,
 };
 const calls:{url:string;method:string}[]=[];
 const fetcher=async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const u=new URL(String(input));assert.equal(u.origin,'https://api.stripe.com');assert.equal(init?.redirect,'error');assert.equal(init?.headers&&new Headers(init.headers).get('authorization'),'Bearer synthetic-private-test-key');calls.push({url:u.pathname,method:init?.method??'GET'});
  const value=base[u.pathname.replace('/v1','')+u.search];return new Response(JSON.stringify(value??{}),{status:value?200:404});
 };
 return{gateway:unblockCommerceGateway(fetcher as typeof fetch),calls};
}
test('contract evidence uses the original subscription invoice and separate provider contract/payment dates',async()=>{
 const{gateway,calls}=fixture();const r=await gateway.contract('sub_test','cus_test','prod_test');assert.equal(+r.at,1794304800000);assert.equal(+r.paidAt,1794304860000);assert.equal(r.invoiceId,'in_first');assert.equal(r.amount,24900);assert.ok(calls.every(c=>c.method==='GET'));
});
test('cross-customer and cross-product invoices cannot grant consumer contract evidence',async()=>{
 await assert.rejects(()=>fixture().gateway.contract('sub_test','cus_wrong','prod_test'));
 await assert.rejects(()=>fixture({'/prices/price_test':{id:'price_test',product:'prod_other'}}).gateway.contract('sub_test','cus_test','prod_test'));
});
test('incomplete invoice pagination fails towards review instead of guessing an initial payment',async()=>{
 const{gateway}=fixture({'/invoices?subscription=sub_test&limit=100':{has_more:true,data:[{id:'in_first',billing_reason:'subscription_create'}]}});await assert.rejects(()=>gateway.contract('sub_test','cus_test','prod_test'));
});
test('refund evidence is bound to the invoice payment and preserves pending status',async()=>{
 const{gateway,calls}=fixture({'/refunds/re_test':{id:'re_test',payment_intent:'pi_test',amount:12450,currency:'nok',status:'pending'}});const r=await gateway.refund('re_test','sub_test','cus_test','in_first','prod_test');assert.equal(r.succeeded,false);assert.equal(r.amount,12450);assert.ok(calls.every(c=>c.method==='GET'));
});
test('a refund from another payment or a changed response identity is rejected',async()=>{
 for(const patch of [{id:'re_other',payment_intent:'pi_test'},{id:'re_test',payment_intent:'pi_other'}]){
  const{gateway}=fixture({'/refunds/re_test':{...patch,amount:24900,currency:'nok',status:'succeeded'}});await assert.rejects(()=>gateway.refund('re_test','sub_test','cus_test','in_first','prod_test'));
 }
});
