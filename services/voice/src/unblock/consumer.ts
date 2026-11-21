import type {Recap} from '../recap/compose.ts';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {EMAIL} from '../signup/form.ts';
import {config,repoRoot} from '../config.ts';
import {encrypt,decrypt} from '../store/crypto.ts';
import type {Database} from '../store/transaction.ts';
import {transaction} from '../store/transaction.ts';
import type {LoopDeps} from '../loop/deps.ts';
import {BillingUnavailable,providerFor} from '../billing/gateway.ts';
import {gatewayFor} from '../billing/service.ts';
import {enqueue} from '../messages/outbox.ts';
import {UnblockRepository,type Enrollment} from './repository.ts';
import {nextOccurrence} from './cadence.ts';
import {nextLight,lightEnabled,type Programme} from './model.ts';
import {CONSUMER_TERMS_VERSION,consumerDeadline,withdrawalDeadline} from './consumer-policy.ts';
import {unblockCommerceGateway,type ContractEvidence} from './commerce-gateway.ts';
import {unblockConfig} from './config.ts';

export interface RefundRequest {id:string;enrollment_id:string|null;reason:string;requested_at:Date;repay_by:Date;guaranteed:boolean;status:string;checkout_reference:string|null;provider:string|null;subscription_id:string|null;invoice_id:string|null;product_id:string|null;amount_minor:number|null;currency:string|null;cancel_confirmed_at:Date|null;next_attempt_at:Date;refund_id:string|null;resolved_at:Date|null;}
const commerce=(deps:LoopDeps)=>deps.unblockCommerce??unblockCommerceGateway();
export function withdrawalForm():string {
 return `WITHDRAWAL FORM (optional: a clear email is also sufficient)\nTo: ${config.company.name()}, ${config.company.address()}, ${config.company.supportEmail()}\n\nI hereby withdraw from my Unblock subscription.\nContract date: __________\nConsumer name: __________\nConsumer address: __________\nAccount email or other account reference: __________\nDate: __________\nSignature (only for a paper form): __________\n`;
}
/** A self-contained snapshot, not just a mutable web link. No private reflection material. */
export function consumerTerms():string {
 const company=`${config.company.name()} (org. nr. ${config.company.orgnr()}), ${config.company.address()}`;
 const privacy=readFileSync(resolve(repoRoot,'legal/privacy.md'),'utf8').replace(/\{\{company\}\}/g,config.company.name()).replace(/\{\{orgnr_clause\}\}/g,` (org. nr. ${config.company.orgnr()})`).replace(/\{\{address\}\}/g,config.company.address()).replace(/\{\{support_email\}\}/g,config.company.supportEmail());
 return `UNBLOCK SUBSCRIPTION TERMS — ${CONSUMER_TERMS_VERSION}\nSeller and data controller: ${company}. Support: ${config.company.supportEmail()}.\n\nEnglish-speaking adults currently in Norway. AI phone conversations for self-reflection, not therapy or an emergency service. No particular result is promised. Opening: about 15–20 minutes. Regular calls: about 10–15 minutes. Optional light calls: about a minute. Calling hours: weekdays 09:00–16:30 Europe/Oslo; human coverage 09:00–17:00. Choose your times in your account.\n\nNOK 249 per month, including applicable VAT, itemised on the receipt. Up to four regular calls per billing month; opening and optional light calls included. Automatically renews monthly until cancelled. No minimum term beyond the paid month. Cancel renewal in your verified Unblock account; confirmation requires the payment provider. Ordinary cancellation keeps access until the paid period ends. Pausing calls continues billing. Calls do not begin until payment and the required information are confirmed. Unblock does not subscribe you to weekly 8&80 or Beliefs.\n\nWITHDRAWAL AND REFUNDS\nYou may withdraw without giving a reason within 14 days after the subscription contract is entered into. The contract is entered into when the provider accepts your subscription checkout, recorded by its subscription-creation timestamp. Pre-payment scheduling or reviewing terms does not itself charge you. Later payment settlement or webhook delivery does not postpone the recorded contract date. The starting day is excluded, and a final non-working day extends to the next working day under the applicable deadline rules. Mandatory extensions for missing information and other consumer rights are preserved.\nFor launch, we refund the full initial NOK 249 payment even after calls during that window, with no deduction or fee. Starting early does not waive this policy. Early calls require your separate explicit request; otherwise calls wait until the initial withdrawal period ends.\nWithdraw through the distinct account action or send a clear statement to ${config.company.supportEmail()}. The form below is optional. Withdrawal stops new Unblock calls and initiates stopping renewal. We acknowledge the request separately from provider-confirmed cancellation and refund. Payments are returned without undue delay, no later than 14 days after receipt of a valid withdrawal notice, using the original payment method unless you expressly agree otherwise.\nOutside withdrawal, ordinary unused time or missed calls do not automatically receive a pro-rata refund. This does not limit statutory rights. When we cannot supply paid service through our fault, we offer a proportionate monetary refund, or the full month if that month cannot be provided. Credits are not compulsory. Contact support about duplicate/incorrect charges or other complaints; statutory claim periods are not shortened.\n\nYOUR ACCOUNT\nYou may pass on a question, end a call, pause calls, export your records or delete your account. Deletion and withdrawing from the contract are separate. STOP stops calls/texts to the shared number but does not itself cancel subscription renewal. Complaint routes and statutory consumer remedies remain available, including Forbrukertilsynet.\n\n${withdrawalForm()}\nPRIVACY SNAPSHOT\n${privacy}`;
}
export async function acceptConsumerTerms(sql:Database,hash:string,email:string,early:boolean,now:Date):Promise<void> {
 if(!EMAIL.test(email)||email.length>254)throw new BillingUnavailable();
 await transaction(sql,async tx=>{
  await tx`select phone_hash from callers where phone_hash=${hash} for update`;
  const [e]=await tx<Enrollment[]>`select * from unblock_enrollments where phone_hash=${hash} and is_current for update`;
  if(!e||e.withdraw_requested_at||e.subscription_id&&e.standing!=='ended')throw new BillingUnavailable();
  const newReview=e.standing==='ended'&&!!e.contract_at;
  if(e.contract_at&&!newReview)throw new BillingUnavailable();
  if(e.terms_accepted_at&&!newReview){if(e.terms_version!==CONSUMER_TERMS_VERSION||!e.contract_email_enc||decrypt(e.contract_email_enc)!==email||!!e.early_start_at!==early)throw new BillingUnavailable();return;}
  await tx`update unblock_enrollments set contract_at=null,contract_subscription_id=null,information_delivered_at=null,contract_notice_id=null,purchase_id=null,payment_id=null,amount_minor=null,currency=null,paid_at=null,terms_version=${CONSUMER_TERMS_VERSION},terms_accepted_at=${now},early_start_at=${early?now:null},contract_email_enc=${encrypt(email)},contract_document_enc=${encrypt(consumerTerms())},updated_at=${now} where id=${e.id}`;
 });
}
export async function contractEvidence(deps:LoopDeps,e:Enrollment,subscription:string,customer:string,product:string,now:Date):Promise<ContractEvidence|undefined>{
 if(e.contract_at||e.terms_version!==CONSUMER_TERMS_VERSION||!e.terms_accepted_at)return;
 const proof=await commerce(deps).contract(subscription,customer,product);
 if(!Number.isFinite(+proof.paidAt)||proof.paidAt>now||!Number.isFinite(+proof.at)||+proof.at+1000<+e.terms_accepted_at||proof.at>now||proof.amount!==24900||proof.currency!=='nok')throw new BillingUnavailable();
 return proof;
}
export function contractMessage(document:string,at:Date,early:boolean,withdrawn?:Date|null):Recap{
 const text=`Your Unblock subscription\n${withdrawn?`Withdrawal already requested on ${withdrawn.toISOString()}. Calls remain stopped; this records your contract information and does not restart calls.\n`:''}Contract entered into: ${at.toISOString()}.\nInitial withdrawal deadline: ${withdrawalDeadline(at).toISOString()} (deadline calculated in Europe/Oslo). A later information delivery or mandatory extension cannot shorten your rights.\nEarly start requested: ${early?'yes; this does not waive withdrawal or the full initial refund':'no; calls wait until the initial withdrawal period ends'}.\n\n${document}`;
 return {subject:'Your Unblock subscription and withdrawal rights',replyTo:config.company.supportEmail(),body:text,parts:text.split('\n\n').map(text=>({role:'body' as const,text}))};
}

export async function recordContract(tx:Database,e:Enrollment,proof:ContractEvidence,now:Date,subscription:string):Promise<void>{
 if(!e.contract_document_enc||!e.contract_email_enc)throw new BillingUnavailable();
 const at=new Date(Math.max(+proof.at,+(e.terms_accepted_at??proof.at)));
 const body=contractMessage(decrypt(e.contract_document_enc),at,!!e.early_start_at,e.withdraw_requested_at);const text=body.body;
 const notice=await enqueue(tx,{eventKey:`unblock:contract:${e.id}:${at.toISOString()}`,phoneHash:e.phone_hash,channel:'email',kind:'unblock-legal',reference:e.id,to:decrypt(e.contract_email_enc),body},now);
 await tx`update unblock_enrollments set contract_at=${at},contract_subscription_id=${subscription},contract_notice_id=${notice},paid_at=${proof.paidAt},purchase_id=${proof.invoiceId},payment_id=${proof.paymentId},amount_minor=${proof.amount},currency=${proof.currency},contract_document_enc=${encrypt(text)} where id=${e.id}`;
}
export async function requestWithdrawal(deps:LoopDeps,hash:string,now:Date):Promise<RefundRequest>{
 return transaction(deps.store.raw,async tx=>{
  await tx`select phone_hash from callers where phone_hash=${hash} for update`;
  const [e]=await tx<Enrollment[]>`select * from unblock_enrollments where phone_hash=${hash} and is_current for update`;if(!e)throw new BillingUnavailable();
  const deadline=consumerDeadline(e);
  const [old]=await tx<RefundRequest[]>`select * from unblock_refund_requests where enrollment_id=${e.id} and reason='withdrawal'`;
  if(old){
   if(now<old.requested_at&&old.status==='requested'&&!old.refund_id){
    const guaranteed=old.guaranteed||!!deadline&&now<=deadline;
    await tx`update unblock_refund_requests set requested_at=${now},repay_by=${new Date(+now+14*86400_000)},guaranteed=${guaranteed},amount_minor=case when ${guaranteed} then coalesce(amount_minor,${e.amount_minor}) else amount_minor end where id=${old.id}`;
    await tx`update unblock_enrollments set withdraw_requested_at=${now} where id=${e.id}`;
    return (await tx<RefundRequest[]>`select * from unblock_refund_requests where id=${old.id}`)[0]!;
   }
   return old;
  }
  const guaranteed=!!deadline&&now<=deadline;
  const id=randomUUID();await tx`insert into unblock_refund_requests(id,enrollment_id,reason,requested_at,repay_by,guaranteed,next_attempt_at,checkout_reference,provider,subscription_id,invoice_id,product_id,amount_minor,currency)
   values(${id},${e.id},'withdrawal',${now},${new Date(+now+14*86400_000)},${guaranteed},${now},${e.checkout_reference},${e.provider},${e.subscription_id},${e.purchase_id},${e.product_id??unblockConfig().productId},${guaranteed?e.amount_minor:null},${e.currency})`;
  await tx`update unblock_enrollments set withdraw_requested_at=${now},opening_at=null,next_weekly_at=null,next_light_at=null,updated_at=${now} where id=${e.id}`;
  const [r]=await tx<RefundRequest[]>`select * from unblock_refund_requests where id=${id}`;
  if(e.contract_email_enc){const text=withdrawalAcknowledgement(r!);await enqueue(tx,{eventKey:`unblock:withdrawal:${id}`,phoneHash:hash,channel:'email',kind:'unblock-legal',reference:e.id,to:decrypt(e.contract_email_enc),body:{subject:'We received your Unblock withdrawal',replyTo:config.company.supportEmail(),body:text,parts:text.split('\n\n').map(text=>({role:'body' as const,text}))}},now);}
  return r!;
 });
}
export function withdrawalAcknowledgement(r:RefundRequest):string {
 return `Unblock withdrawal received\nReference: ${r.id}\nReceived: ${r.requested_at.toISOString()}\nNew Unblock calls are stopped. Cancellation of renewal has been requested; this acknowledgement does not claim that the payment provider has confirmed it.\n${r.guaranteed?'Your request is within the recorded withdrawal window. The full initial payment is due back without a call deduction.':'A person will review your withdrawal/refund entitlement; statutory rights and extensions are preserved.'}\nWithdrawal repayment deadline: ${r.repay_by.toISOString()}. We return payments without undue delay using the original payment method unless you expressly agree otherwise. This is receipt of your request, not confirmation that money has been refunded.\nSupport: ${config.company.supportEmail()}\nSeller: ${config.company.name()}, ${config.company.address()}.`;
}
/** Reconcile delivered durable notices and retry cancellation independently of refund processing. No refund writes. */
export async function maintainUnblockConsumer(deps:LoopDeps,now=new Date()):Promise<void>{
 const notices=await deps.store.raw<{id:string;phone_hash:string;delivered_at:Date}[]>`select e.id,e.phone_hash,m.delivered_at from unblock_enrollments e join message_outbox m on e.contract_notice_id=m.id where e.information_delivered_at is null and m.phone_hash=e.phone_hash and m.reference=e.id and m.kind='unblock-legal' and m.event_key like 'unblock:contract:%' and m.status='delivered' and m.delivered_at is not null`;
 for(const notice of notices)await transaction(deps.store.raw,async tx=>{
  await tx`select phone_hash from callers where phone_hash=${notice.phone_hash} for update`;
  const [e]=await tx<Enrollment[]>`select * from unblock_enrollments where id=${notice.id} for update`;if(!e||e.information_delivered_at)return;
  await tx`update unblock_enrollments set information_delivered_at=${notice.delivered_at} where id=${e.id}`;
  const p=JSON.parse(decrypt(e.programme_enc)) as Programme;
  if(e.withdraw_requested_at||p.state!=='active'||e.weekly_weekday===null||e.weekly_minute===null)return;
  const delivered={...e,information_delivered_at:notice.delivered_at};const after=e.early_start_at?now:new Date(Math.max(+now,+(consumerDeadline(delivered)??now)+1));
  if(!p.openingHeld){const opening=e.opening_at&&e.opening_at>after?e.opening_at:nextOccurrence({timezone:e.timezone,weekdays:[e.weekly_weekday],minute:e.weekly_minute},after);await tx`update unblock_enrollments set opening_at=${opening} where id=${e.id}`;delivered.opening_at=opening;}
  await UnblockRepository.replan(tx,delivered,p,after);
  if(lightEnabled(p,{lightWeekdays:e.light_weekdays,lightMinute:e.light_minute})&&e.light_minute!==null)await tx`update unblock_enrollments set next_light_at=${nextLight(after,e.light_weekdays,e.light_minute,e.timezone)} where id=${e.id}`;
 });
 // A failed canonical read must not strand a paid account forever. Re-read, without fabricating contract dates.
 const contracts=await deps.store.raw<{phone_hash:string}[]>`select phone_hash from unblock_enrollments where is_current and standing='active' and contract_at is null and terms_version=${CONSUMER_TERMS_VERSION} and subscription_id is not null limit 10`;
 for(const e of contracts){try{const {refreshUnblock}=await import('./billing.ts');await refreshUnblock(deps,e.phone_hash,now);}catch{/* Remains held for review and a later authoritative read. */}}
 const rows=await deps.store.raw<RefundRequest[]>`select * from unblock_refund_requests where reason='withdrawal' and cancel_confirmed_at is null and next_attempt_at<=${now} order by requested_at limit 20`;
 for(const r of rows){
  try{
   await transaction(deps.store.raw,async tx=>{
    const [e]=r.enrollment_id?await tx<Enrollment[]>`select * from unblock_enrollments where id=${r.enrollment_id}`:[];
    if(e)await tx`select phone_hash from callers where phone_hash=${e.phone_hash} for update`;
    const [current]=await tx<RefundRequest[]>`select * from unblock_refund_requests where id=${r.id} and cancel_confirmed_at is null and next_attempt_at<=${now} for update`;if(!current)return;
    const subscription=e?.subscription_id??current.subscription_id,provider=e?.provider??current.provider,product=e?.product_id??current.product_id;
    if(!subscription||provider!=='stripe'||!product)throw new BillingUnavailable();
    const sub=await gatewayFor(deps).cancel(providerFor(provider),subscription);
    if(sub.subscriptionId!==subscription||e?.customer_id&&sub.customerId!==e.customer_id||!sub.productIds?.includes(product)||!sub.cancelAtPeriodEnd&&sub.standing!=='ended')throw new BillingUnavailable();
    await tx`update unblock_refund_requests set status=case when status='reviewed' and subscription_id is null then 'requested' else status end,resolved_at=case when status='reviewed' and subscription_id is null then null else resolved_at end,cancel_confirmed_at=${now},subscription_id=${subscription},provider=${provider},product_id=${product},invoice_id=coalesce(invoice_id,${e?.purchase_id??null}),amount_minor=case when guaranteed then coalesce(amount_minor,${e?.amount_minor??null}) else amount_minor end,currency=coalesce(currency,${e?.currency??null}) where id=${r.id}`;
    if(e)await tx`update unblock_enrollments set cancel_at_period_end=${sub.cancelAtPeriodEnd},paid_until=${sub.endsAt?new Date(sub.endsAt):null},updated_at=${now} where id=${e.id}`;
   });
  }catch{await deps.store.raw`update unblock_refund_requests set next_attempt_at=${new Date(+now+5*60_000)} where id=${r.id} and cancel_confirmed_at is null`;}
 }
 await deps.store.raw`delete from unblock_refund_requests where resolved_at<${new Date(+now-30*86400_000)} and enrollment_id is null`;
}
/** Human-reviewed provider-console refund, verified read-only against its original invoice/payment. */
export async function confirmUnblockRefund(deps:LoopDeps,requestId:string,refundId:string,now=new Date()):Promise<void>{
 const [r]=await deps.store.raw<RefundRequest[]>`select * from unblock_refund_requests where id=${requestId}`;
 if(!r||!r.subscription_id||!r.invoice_id||!r.product_id||!r.amount_minor||r.provider!=='stripe')throw new BillingUnavailable();
 const sub=await gatewayFor(deps).subscription('stripe',r.subscription_id);
 const proof=await commerce(deps).refund(refundId,r.subscription_id,sub.customerId,r.invoice_id,r.product_id);
 if(proof.id!==refundId||proof.invoiceId!==r.invoice_id||!proof.succeeded||proof.amount!==r.amount_minor||proof.currency!==r.currency||r.reason==='withdrawal'&&!r.cancel_confirmed_at)throw new BillingUnavailable();
 await transaction(deps.store.raw,async tx=>{const [current]=await tx<RefundRequest[]>`select * from unblock_refund_requests where id=${r.id} for update`;if(!current||current.amount_minor!==r.amount_minor||current.invoice_id!==r.invoice_id)throw new BillingUnavailable();if(current.refund_id){if(current.refund_id!==refundId)throw new BillingUnavailable();return;}await tx`update unblock_refund_requests set refund_id=${refundId},status='refunded',resolved_at=${now} where id=${r.id}`;});
}
/** Explicit human review sets the amount for other complaints; it cannot reduce a guaranteed initial refund. */
export async function reviewUnblockRefund(sql:Database,id:string,invoice:string,amount:number,now=new Date()):Promise<void>{
 if(!Number.isInteger(amount)||amount<=0)throw new BillingUnavailable();
 const changed=await sql`update unblock_refund_requests set invoice_id=${invoice},amount_minor=${amount},currency='nok',next_attempt_at=${now} where id=${id} and status='requested' and not guaranteed returning id`;if(!changed.length)throw new BillingUnavailable();
}
export async function openUnblockRefundReview(sql:Database,enrollment:string,reason:'service_failure'|'billing_error',now=new Date()):Promise<void>{
 const [e]=await sql<Enrollment[]>`select * from unblock_enrollments where id=${enrollment}`;if(!e)throw new BillingUnavailable();
 await sql`insert into unblock_refund_requests(id,enrollment_id,reason,requested_at,repay_by,next_attempt_at,provider,subscription_id,product_id,currency) values(${randomUUID()},${e.id},${reason},${now},${new Date(+now+14*86400_000)},${now},${e.provider},${e.subscription_id},${e.product_id},${e.currency}) on conflict do nothing`;
}
export function consumerNoticesApproved():boolean{return unblockConfig().consumerNoticesApproved;}

/** Signed late checkout for an erased account: preserve repayment/cancellation, never recreate the account. */
export async function trackErasedWithdrawal(deps:LoopDeps,reference:string,subscription:string,provider:string,now:Date):Promise<boolean>{
 const [r]=await deps.store.raw<RefundRequest[]>`select * from unblock_refund_requests where checkout_reference=${reference} and enrollment_id is null and reason='withdrawal'`;
 if(!r||provider!=='stripe'||!r.product_id)return false;
 const sub=await gatewayFor(deps).subscription('stripe',subscription);
 if(sub.subscriptionId!==subscription||!sub.productIds?.includes(r.product_id))throw new BillingUnavailable();
 let proof:ContractEvidence|undefined;try{proof=await commerce(deps).contract(subscription,sub.customerId,r.product_id);}catch{/* Cancellation proceeds while repayment evidence is reviewed. */}
 await deps.store.raw`update unblock_refund_requests set cancel_confirmed_at=case when subscription_id is distinct from ${subscription} then null else cancel_confirmed_at end,provider='stripe',subscription_id=${subscription},invoice_id=coalesce(invoice_id,${proof?.invoiceId??null}),amount_minor=coalesce(amount_minor,${proof?.amount??null}),currency=coalesce(currency,${proof?.currency??null}),status='requested',resolved_at=null,next_attempt_at=${now} where id=${r.id}`;
 return true;
}

/** Records a completed human review without claiming a refund. Guaranteed repayment cannot be waived here. */
export async function resolveUnblockRefundReview(sql:Database,id:string,now=new Date()):Promise<void>{
 const changed=await sql`update unblock_refund_requests set status='reviewed',resolved_at=${now} where id=${id} and status='requested' and not guaranteed and (reason<>'withdrawal' or subscription_id is null or cancel_confirmed_at is not null) returning id`;if(!changed.length)throw new BillingUnavailable();
}
