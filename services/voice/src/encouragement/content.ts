import { createHash } from 'node:crypto';
import type { Preferences } from './preferences.ts';

type Topic=Preferences['content'][number];
export interface Variant { id:string; topic:Topic; tone:Preferences['tone']; arm:'A'|'B'; score:8|9; text:string; }
/** Editorial scores, not measured effectiveness. Only reviewed variants above 7 ship. */
const copy:Record<Preferences['tone'],Record<Topic,[string,string]>>={
  gentle:{encouragement:['A small reminder: you deserve a little kindness today. One small step is enough.','You can take today at your own pace. There is room for a small beginning.'],
    recognition:['You have followed through on an action before. Let that count, even when the next step feels small.','Something you chose to do got done before. You can give yourself credit for that.'],
    action:['A gentle nudge about the focus you chose: “{{focus}}”. What is one small step you could take?','Your chosen focus: “{{focus}}”. You can make a little room for it, at your own pace.']},
  practical:{encouragement:['Pick one useful thing you can do in five minutes. Start there; the rest can wait.','Make the next step small enough to start. A few minutes can be useful.'],
    recognition:['You have completed an action you chose before. What helped you follow through then?','You have followed through before. Reuse one thing that made it easier.'],
    action:['Your focus: “{{focus}}”. Choose the smallest useful next step and a time for it.','Make five minutes for your focus: “{{focus}}”. One concrete step is enough.']},
  playful:{encouragement:['Tiny steps still get to call themselves steps. Pick a little one today.','Permission slip for today: start small, make it imperfect, see what happens.'],
    recognition:['You have put a tick next to an action before. That little tick counts.','Past you followed through on an action. Give that version of you a small high five.'],
    action:['A friendly tap on the shoulder from your chosen focus: “{{focus}}”. Fancy one tiny step?','Your focus is waving hello: “{{focus}}”. No grand entrance needed; a small start will do.']},
  direct:{encouragement:['You matter. Pick one small thing that is worth your time today, and start there.','You do not need a perfect day to take one useful step. Make it small and begin.'],
    recognition:['You have followed through on an action before. Give yourself credit, then choose your next step.','You have evidence that you can follow through: an action you chose got done before.'],
    action:['You chose this focus: “{{focus}}”. Give it one small, concrete step today.','Your focus: “{{focus}}”. What can you do in the next five minutes?']},
};
export const variants:Variant[]=Object.entries(copy).flatMap(([tone,byTopic])=>Object.entries(byTopic).flatMap(([topic,texts])=>texts.map((text,i)=>({
  id:`v1-${tone}-${topic}-${i?'B':'A'}`,tone:tone as Preferences['tone'],topic:topic as Topic,arm:i?'B':'A',score:i?8:9,text,
}))));
export function choose(p:Preferences, seed:string, hasProgress:boolean, history:{variant:string;feedback:string|null}[]):Variant|undefined{
  const negative=new Set(history.filter(h=>h.feedback==='less').map(h=>h.variant));
  const positive=new Set(history.filter(h=>h.feedback==='more').map(h=>h.variant));
  const pool=variants.filter(v=>v.score>7 && v.tone===p.tone && p.content.includes(v.topic) && !negative.has(v.id)
    && (v.topic!=='recognition'||hasProgress) && (v.topic!=='action'||!!p.focus));
  // Stable sequence avoids immediate repeats unless the user asked for more of that wording.
  const fresh=pool.filter(v=>v.id!==history[0]?.variant||positive.has(v.id)), choices=fresh.length?fresh:pool;
  const weighted=choices.flatMap(v=>Array.from({length:positive.has(v.id)?2:1},()=>v));
  if(!weighted.length)return undefined;
  return weighted[createHash('sha256').update(seed).digest().readUInt32BE(0)%weighted.length];
}
export function compose(v:Variant,p:Preferences):string{
  const text=v.text.replace('{{focus}}',p.focus);
  return `8&80: ${p.swearing&&p.tone==='direct'?'You are fucking worth the effort. ':''}${text}\nPreferences, pause and feedback: 8and80.me/me\nReply STOP to stop calls and texts.`;
}
