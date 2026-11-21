import {config} from '../config.ts';
import {openDeps} from '../control.ts';
import {confirmUnblockRefund,reviewUnblockRefund,openUnblockRefundReview,resolveUnblockRefundReview,requestWithdrawal,type RefundRequest} from './consumer.ts';
const deps=openDeps();
try{
 const a=process.argv.slice(2);void config;
 if(!a.length||a[0]==='--list'){
  const rows=await deps.store.raw<RefundRequest[]>`select * from unblock_refund_requests where status='requested' order by repay_by limit 100`;
  console.log(JSON.stringify(rows));
 }else if(a[0]==='--withdraw'&&a[1]&&a[2]==='--received-at'&&a[3]&&a[4]==='--customer-notice'){
  const at=new Date(a[3]);if(!/T.+(?:Z|[+-]\d{2}:\d{2})$/.test(a[3])||!Number.isFinite(+at)||at>new Date())throw Error('Use the actual received timestamp with timezone.');
  const [e]=await deps.store.raw`select phone_hash from unblock_enrollments where id=${a[1]} and is_current`;if(!e)throw Error('Current Unblock contract not found.');
  await requestWithdrawal(deps,String(e['phone_hash']),at);console.log('Customer withdrawal notice recorded with its received time. New calls are stopped; provider cancellation/refund are separate.');
 }else if(a[0]==='--confirm'&&a[1]&&a[2]&&a[3]==='--provider-reviewed'){
  await confirmUnblockRefund(deps,a[1],a[2]);console.log('Canonical provider refund verified. No payment write or message was performed.');
 }else if(a[0]==='--review'&&a[1]&&a[2]&&a[3]&&a[4]==='--reviewed'){
  await reviewUnblockRefund(deps.store.raw,a[1],a[2],Number(a[3]));console.log('Reviewed invoice and amount recorded. No refund was issued.');
 }else if(a[0]==='--resolve-review'&&a[1]&&a[2]==='--reviewed-no-refund'){
  await resolveUnblockRefundReview(deps.store.raw,a[1]);console.log('Human review recorded without a refund. Withdrawal call blocks remain.');
 }else if(a[0]==='--open'&&a[1]&&['service_failure','billing_error'].includes(a[2]??'')&&a[3]==='--reviewed'){
  await openUnblockRefundReview(deps.store.raw,a[1],a[2] as 'service_failure'|'billing_error');console.log('Private refund review opened. No payment or message was sent.');
 }else throw Error('Use --list, --withdraw ENROLLMENT_ID --received-at ISO_TIMESTAMP --customer-notice, --resolve-review REQUEST_ID --reviewed-no-refund, --confirm REQUEST_ID REFUND_ID --provider-reviewed, --review REQUEST_ID INVOICE_ID AMOUNT_MINOR --reviewed, or --open ENROLLMENT_ID service_failure|billing_error --reviewed.');
}catch{console.error('Refund action was not confirmed. Keep provider and database diagnostics private; inspect on the server.');process.exitCode=1}finally{await deps.store.close();}
