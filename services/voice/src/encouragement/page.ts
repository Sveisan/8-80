import type { Preferences } from './preferences.ts';
import { compose, variants } from './content.ts';

export interface EncouragementView { preferences:Preferences; history:{id:string;topic:string;tone:string;status:string;feedback:string|null;created_at:Date;body?:string}[]; note?:string; }
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const clock=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function encouragementSection(view:EncouragementView):string{
  const p=view.preferences;
  const select=(name:string,label:string,options:[string,string][],value:string)=>`<label for="enc-${name}">${label}</label><select id="enc-${name}" name="${name}">${options.map(([v,t])=>`<option value="${v}"${v===value?' selected':''}>${t}</option>`).join('')}</select>`;
  const preview=variants.find(v=>v.tone===p.tone && p.content.includes(v.topic) && v.topic==='encouragement')
    ?? variants.find(v=>v.tone===p.tone && v.topic==='encouragement')!;
  return `<section class="account-section" id="encouragement" aria-labelledby="encouragement-heading">
    <h2 id="encouragement-heading">Encouragement by SMS</h2>
    <p class="hint">Optional messages in the style you choose. Off until you opt in. Messages can appear on your lock screen.</p>
    <p role="status">${view.note?esc(view.note):!p.enabled?'Encouragement is off.':p.paused?'Encouragement is paused.':'Encouragement is on.'}</p>
    <form method="post">
      <input type="hidden" name="enc_revision" value="${p.revision}">
      <label><input type="checkbox" name="enabled" value="yes"${p.enabled?' checked':''}> I want encouragement by SMS at the frequency below.</label>
      ${select('frequency','Frequency',[['weekly','Once a week — Tuesday'],['three','Three times a week — Monday, Wednesday, Friday'],['daily','Daily']],p.frequency)}
      <p class="hint">At most one per day. The first message is on a future scheduled day, from 10:00 in your chosen timezone, outside quiet hours. Missed messages are skipped.</p>
      ${select('tone','Tone',[['gentle','Gentle'],['practical','Practical'],['playful','Playful'],['direct','Direct']],p.tone)}
      <label><input type="checkbox" name="swearing" value="yes"${p.swearing?' checked':''}> Strong language is welcome with direct wording.</label>
      <fieldset><legend>Message types</legend>
        ${[['encouragement','A little encouragement'],['recognition','Recognition of actions I have reported completing'],['action','A nudge about my chosen focus below']].map(([v,t])=>`<label><input type="checkbox" name="content" value="${v}"${p.content.includes(v as Preferences['content'][number])?' checked':''}> ${t}</label>`).join('')}
      </fieldset>
      <label for="enc-focus">My chosen focus (optional, required for action nudges)</label>
      <input id="enc-focus" name="focus" maxlength="160" value="${esc(p.focus)}" autocomplete="off">
      <p class="hint">Your words may be included in an SMS. Recognition is sent only when you have reported completing an action; we never infer how you feel or invent progress. With only recognition selected, there may be no message yet.</p>
      <fieldset><legend>Quiet hours</legend><div class="row">
        <div><label for="enc-quiet-start">Quiet hours start</label><input type="time" id="enc-quiet-start" name="quiet_start" value="${clock(p.quietStart)}" required></div>
        <div><label for="enc-quiet-end">Quiet hours end</label><input type="time" id="enc-quiet-end" name="quiet_end" value="${clock(p.quietEnd)}" required></div>
      </div></fieldset>
      <label for="enc-timezone">Timezone</label><input id="enc-timezone" name="timezone" value="${esc(p.timezone)}" placeholder="Europe/Oslo" required>
      <button name="action" value="encouragement-save">Save encouragement preferences</button>
      <p class="hint">Saving preferences keeps an existing pause in place. Resume separately when you are ready. Account pauses, SMS STOP and safety holds also prevent these messages.</p>
    </form>
    ${p.enabled?`<form method="post"><input type="hidden" name="enc_revision" value="${p.revision}"><button name="action" value="encouragement-${p.paused?'resume':'pause'}">${p.paused?'Resume':'Pause'} encouragement</button><button class="quiet" name="action" value="encouragement-stop">Stop encouragement</button></form>`:''}
    <details class="change-time"><summary>Example of ${esc(p.tone)} wording</summary><p>${esc(compose(preview,p).split('\n')[0]!)}</p><p class="hint">This example shows tone. Message types, your focus and feedback shape what is sent.</p></details>
    ${view.history.length?`<h3>Recent messages and feedback</h3><p class="hint">Delivery status is shown below. More like this increases reuse of that wording. Less like this excludes that wording for 30 days. No reply is needed.</p>${view.history.map(h=>`<form method="post"><input type="hidden" name="delivery" value="${esc(h.id)}"><p>${esc(new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:p.timezone}).format(h.created_at))} · ${esc(h.topic)} · ${esc(h.tone)} · ${esc(h.status==='accepted'?'Submitted to SMS provider':h.status==='delivered'?'Delivered':h.status==='uncertain'?'Delivery unconfirmed':'Delivery failed')}${h.feedback?` · ${h.feedback==='more'?'More':'Less'} like this saved`:''}</p>${h.body?`<p>${esc(h.body)}</p>`:''}${['accepted','delivered'].includes(h.status)?`<button name="action" value="encouragement-more">More like this</button><button name="action" value="encouragement-less">Less like this</button>${h.feedback?'<button class="quiet" name="action" value="encouragement-clear">Clear feedback</button>':''}`:''}</form>`).join('')}`:''}
  </section>`;
}
