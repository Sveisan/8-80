import {BillingUnavailable} from '../billing/gateway.ts';
import {obj,str} from '../billing/types.ts';
export interface ContractEvidence {at:Date;paidAt:Date;invoiceId:string;paymentId:string;amount:number;currency:string;}
export interface RefundEvidence {id:string;invoiceId:string;amount:number;currency:string;succeeded:boolean;}
export interface UnblockCommerceGateway {
 contract(subscription:string,customer:string,product:string):Promise<ContractEvidence>;
 refund(id:string,subscription:string,customer:string,invoice:string,product:string):Promise<RefundEvidence>;
}
const id=(v:unknown):string|undefined=>str(v)??str(obj(v)?.['id']);
/** Read-only canonical provider evidence. No refunds are issued by this adapter. */
export function unblockCommerceGateway(fetcher:typeof fetch=fetch):UnblockCommerceGateway {
 async function get(path:string):Promise<Record<string,unknown>> {
  const key=process.env['STRIPE_SECRET_KEY'];if(!key)throw new BillingUnavailable();
  const r=await fetcher('https://api.stripe.com/v1'+path,{headers:{authorization:'Bearer '+key,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new BillingUnavailable();const value=obj(await r.json());if(!value)throw new BillingUnavailable();return value;
 }
 async function invoice(invoiceId:string,subscription:string,customer:string,product:string){
  const v=await get('/invoices/'+encodeURIComponent(invoiceId));
  const parent=obj(obj(v['parent'])?.['subscription_details']);
  if(v['id']!==invoiceId||id(v['customer'])!==customer||(id(v['subscription'])??id(parent?.['subscription']))!==subscription||v['status']!=='paid'||!Number.isInteger(v['amount_paid'])||Number(v['amount_paid'])<0||v['currency']!=='nok')throw new BillingUnavailable();
  const lines=obj(v['lines']);const data=lines?.['data'];if(lines?.['has_more']||!Array.isArray(data)||data.length!==1)throw new BillingUnavailable();
  const line=obj(data[0]),pricing=obj(obj(line?.['pricing'])?.['price_details']);const priceId=id(line?.['price'])??id(pricing?.['price']);if(!priceId)throw new BillingUnavailable();
  const price=await get('/prices/'+encodeURIComponent(priceId));if(price['id']!==product&&id(price['product'])!==product)throw new BillingUnavailable();
  let payment=id(v['payment_intent']);
  if(!payment){const payments=await get('/invoice_payments?invoice='+encodeURIComponent(invoiceId)+'&limit=100');const items=payments['data'];if(payments['has_more']||!Array.isArray(items))throw new BillingUnavailable();const paid=items.map(obj).filter(p=>p?.['status']==='paid');if(paid.length!==1)throw new BillingUnavailable();payment=id(obj(paid[0]?.['payment'])?.['payment_intent']);}
  if(!payment)throw new BillingUnavailable();
  return {v,payment};
 }
 return {
  async contract(subscription,customer,product){
   const s=await get('/subscriptions/'+encodeURIComponent(subscription));
   if(s['id']!==subscription||id(s['customer'])!==customer||!Number.isInteger(s['created']))throw new BillingUnavailable();
   // The first subscription invoice, not the newest renewal after a delayed webhook.
   const list=await get('/invoices?subscription='+encodeURIComponent(subscription)+'&limit=100');const rows=list['data'];if(list['has_more']||!Array.isArray(rows))throw new BillingUnavailable();
   const first=rows.map(obj).filter(x=>x?.['billing_reason']==='subscription_create');if(first.length!==1||!str(first[0]?.['id']))throw new BillingUnavailable();
   const invoiceId=str(first[0]!['id'])!;const {v,payment}=await invoice(invoiceId,subscription,customer,product);
   if(!Number.isInteger(obj(v['status_transitions'])?.['paid_at'])||v['amount_paid']!==24900)throw new BillingUnavailable();
   return {at:new Date(Number(s['created'])*1000),paidAt:new Date(Number(obj(v['status_transitions'])?.['paid_at'])*1000),invoiceId,paymentId:payment,amount:Number(v['amount_paid']),currency:String(v['currency'])};
  },
  async refund(refundId,subscription,customer,invoiceId,product){
   const r=await get('/refunds/'+encodeURIComponent(refundId)),proof=await invoice(invoiceId,subscription,customer,product);
   if(r['id']!==refundId||id(r['payment_intent'])!==proof.payment||r['currency']!==proof.v['currency']||!Number.isInteger(r['amount'])||Number(r['amount'])<=0||Number(r['amount'])>Number(proof.v['amount_paid']))throw new BillingUnavailable();
   return {id:refundId,invoiceId,amount:Number(r['amount']),currency:String(r['currency']),succeeded:r['status']==='succeeded'};
  }
 };
}
