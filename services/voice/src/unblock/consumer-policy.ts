import { localDate, zonedTimeToUtc } from '../schedule/time.ts';
export const CONSUMER_TERMS_VERSION = 'unblock-consumer-2026-11-21';
const DAY=86400_000;
/** Norwegian statutory deadline: exclude the starting date, include 14 local dates, extend non-working final days. */
export function withdrawalDeadline(from:Date):Date {
  const d=localDate(from,'Europe/Oslo');let date=new Date(Date.UTC(d.year,d.month-1,d.day+14));
  while(nonWorking(date))date=new Date(+date+DAY);
  return new Date(+zonedTimeToUtc(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate()+1,0,'Europe/Oslo')-1);
}
function nonWorking(date:Date):boolean {
  if([0,6].includes(date.getUTCDay()))return true;
  const year=date.getUTCFullYear(),md=`${date.getUTCMonth()+1}-${date.getUTCDate()}`;
  if(['1-1','5-1','5-17','12-25','12-26'].includes(md))return true;
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;
  const easter=Date.UTC(year,Math.floor(n/31)-1,n%31+1);
  return [-3,-2,0,1,39,49,50].some(offset=>+date===easter+offset*DAY);
}
export interface ConsumerState {
  subscription_id?:string|null;contract_subscription_id?:string|null;
  terms_version?:string|null; terms_accepted_at?:Date|null; contract_at?:Date|null;
  early_start_at?:Date|null; information_delivered_at?:Date|null; withdraw_requested_at?:Date|null;
}
export function consumerCallsAllowed(e:ConsumerState,now:Date):boolean {
  return !!e.contract_subscription_id&&(!e.subscription_id||e.subscription_id===e.contract_subscription_id)&&e.terms_version===CONSUMER_TERMS_VERSION&&!!e.contract_at&&!!e.information_delivered_at&&!e.withdraw_requested_at&&
    (!!e.early_start_at||now>(consumerDeadline(e)??withdrawalDeadline(e.contract_at)));
}
/** Missing/late information never silently shortens the consumer's window. */
export function consumerDeadline(e:ConsumerState):Date|null {
  if(!e.contract_at)return null;
  const yearLater=new Date(+e.contract_at);yearLater.setUTCFullYear(yearLater.getUTCFullYear()+1);
  if(e.information_delivered_at&&e.information_delivered_at<=yearLater)return withdrawalDeadline(new Date(Math.max(+e.contract_at,+e.information_delivered_at)));
  return withdrawalDeadline(yearLater);
}
