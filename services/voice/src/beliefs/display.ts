import { createHash } from 'node:crypto';

/** Display-only: no form, stored zone or appointment is changed by travel. */
export const localDisplayScript = `(()=>{try{const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;if(!zone)return;document.querySelectorAll('time[data-local-appointment]').forEach(node=>{const at=new Date(node.dateTime);if(!Number.isFinite(+at))return;node.textContent=new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(at);const label=document.querySelector('[data-display-zone]');if(label)label.textContent='Shown in your local time · '+zone;});}catch{}})();`;
export const displayHash = createHash('sha256').update(localDisplayScript).digest('base64');
