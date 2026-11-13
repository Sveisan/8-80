import type { Database } from '../store/transaction.ts';

/** Descriptive only. Adaptive assignments and pilot traffic cannot establish an A/B winner. */
export async function encouragementReport(sql:Database){
  const arms=await sql`select d.tone,d.topic,d.arm,d.pilot,d.adaptive,count(*)::int as queued,
    count(*) filter(where m.status='accepted')::int as submitted,
    count(*) filter(where m.status='delivered')::int as delivered,
    count(*) filter(where d.feedback='more')::int as more,
    count(*) filter(where d.feedback='less')::int as less
    from encouragement_deliveries d left join message_outbox m on m.id=d.id
    group by d.tone,d.topic,d.arm,d.pilot,d.adaptive order by d.pilot,d.adaptive,d.tone,d.topic,d.arm`;
  return {window:'Retained 30-day history',arms,winner:null,
    limitations:'Editorial scores are not effectiveness scores. Stable hashed wording allocation rotates through eligible variants. Explicit feedback adapts later choices; adaptive and pilot rows are separated. Feedback is optional and selected by the respondent. No causal lift or automatic global activation is inferred.'};
}
