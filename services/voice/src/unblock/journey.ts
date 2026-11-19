import { createHash } from 'node:crypto';

/** Only editable, non-secret fields are echoed after a failed submission. */
const EDITABLE = new Set(['name', 'email', 'phone', 'consent', 'timezone', 'opening_local', 'calls', 'weekday', 'weekly', 'light_choice', 'light_day', 'light']);
export function formValues(form: URLSearchParams): URLSearchParams {
  return new URLSearchParams([...form].filter(([key]) => EDITABLE.has(key)));
}
export function invalidField(code: string): string | undefined {
  return ({ timezone_invalid: 'timezone', onboarding_time_invalid: 'opening_local', nonexistent_local_time: 'opening_local',
    calls_invalid: 'calls', days_invalid: 'light_choice', calls_too_close: 'light', base_calls_too_close: 'weekly',
    schedule_invalid: 'weekly', time_invalid: 'light', outside_coverage: 'opening_local' } as Record<string, string>)[code];
}

/** Progressive enhancement only: native forms and server validation remain authoritative. */
export const JOURNEY_SCRIPT = `(()=>{
  const root=document.querySelector('[data-unblock-schedule]');
  if(root){
    const form=root.closest('form'), zone=form.elements.namedItem('timezone');
    if(root.hasAttribute('data-detect-zone')){try{
      const detected=Intl.DateTimeFormat().resolvedOptions().timeZone;
      if(detected){zone.value=detected;
        const date=iso=>new Date(iso), parts=iso=>new Intl.DateTimeFormat('en-GB',{timeZone:detected,weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date(iso));
        const local=iso=>{const p=parts(iso),get=t=>p.find(x=>x.type===t).value;return {day:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(get('weekday')),time:get('hour')+':'+get('minute')};};
        const first=form.elements.namedItem('opening_local');if(first){const iso=root.dataset.openingDefault;
          first.value=new Intl.DateTimeFormat('sv-SE',{timeZone:detected,year:'numeric',month:'2-digit',day:'2-digit'}).format(date(iso))+'T'+local(iso).time;
        }
        const regular=local(root.dataset.regularDefault);form.elements.namedItem('weekday').value=String(regular.day);form.elements.namedItem('weekly').value=regular.time;
        const light=root.dataset.lightDefaults.split(',').map(local);form.elements.namedItem('light').value=light[0].time;
        for(const input of form.querySelectorAll('[name=light_day]'))input.checked=light.some(slot=>slot.day===Number(input.value));
      }
    }catch{}}
    const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const update=()=>{
      const none=form.querySelector('[name=light_choice]:checked')?.value==='none';
      const settings=root.querySelector('[data-light-settings]');settings.hidden=none;settings.disabled=none;
      root.querySelector('[data-zone-summary]').textContent='Times in '+zone.value.replace(/_/g,' ');
      const weekday=Number(form.elements.namedItem('weekday').value), calls=Number(form.elements.namedItem('calls').value);
      const regular=days[weekday]+(calls>4?' and '+days[(weekday+3)%7]:'')+' at '+form.elements.namedItem('weekly').value;
      const first=form.elements.namedItem('opening_local');
      root.querySelector('[data-schedule-summary]').textContent=(first?'First conversation: '+first.value.replace('T',' at ')+'. ':'')+
        'Regular calls: '+regular+' · '+zone.value+'. '+calls+' per month, spread across your billing month. '+
        (none?'No light calls.':'Light calls: '+Array.from(form.querySelectorAll('[name=light_day]:checked')).map(n=>days[Number(n.value)]).join(', ')+' at '+form.elements.namedItem('light').value+'.');
    };
    form.addEventListener('change',update);form.addEventListener('input',update);update();
  }
  const invalid=document.querySelector('[aria-invalid=true]');
  if(invalid){const details=invalid.closest('details');if(details)details.open=true;invalid.focus();}
})();`;
export const journeyHash = createHash('sha256').update(JOURNEY_SCRIPT).digest('base64');
