import { enabled } from './model.ts';
import { createHash } from 'node:crypto';
import { PRODUCT_FEEDBACK_CSS } from '../design-system/pages.ts';

/** No session, screenshot, form contents or network request until deliberately opened. */
export function feedbackWidget(): string {
  if (!enabled()) return '';
  return `<style>${PRODUCT_FEEDBACK_CSS}</style>
<aside class="pf" aria-label="Product feedback">
  <button type="button" class="pf-trigger" aria-haspopup="dialog" aria-controls="pf-dialog" hidden>Feedback</button>
  <dialog id="pf-dialog" aria-labelledby="pf-title">
    <div class="pf-heading"><h2 id="pf-title">A thought for us?</h2><button type="button" class="pf-close" aria-label="Close feedback">Close</button></div>
    <form class="pf-form">
      <label for="pf-comment">What could be better?</label>
      <textarea id="pf-comment" name="comment" rows="3" maxlength="4000" required aria-describedby="pf-comment-error" placeholder="Something awkward, something missing, or a little idea…"></textarea>
      <p id="pf-comment-error" role="alert" hidden></p>
      <div class="pf-attachment"><label for="pf-image">Add a screenshot <span>(optional)</span></label><input id="pf-image" type="file" accept="image/png,image/jpeg,image/webp"><img class="pf-preview" alt="Screenshot to include with your feedback" hidden><button class="pf-remove" type="button" hidden>Remove screenshot</button></div>
      <p class="pf-quiet">Your note goes privately to the 8&amp;80 team. Only the image you choose is attached.</p>
      <button type="submit" class="pf-send">Send feedback</button>
    </form>
    <p class="pf-status" role="status" aria-live="polite"></p>
    <details class="pf-history"><summary>Your feedback</summary><p class="pf-quiet">From this browser, kept for up to 30 days. You can remove it here.</p><div class="pf-reports"></div></details>
  </dialog>
</aside><script>${FEEDBACK_WIDGET_SCRIPT}</script>`;
}

export const FEEDBACK_WIDGET_SCRIPT = `(function () {
  var root=document.querySelector('aside.pf'); if(!root) return;
  var dialog=root.querySelector('dialog'), trigger=root.querySelector('.pf-trigger'), close=root.querySelector('.pf-close');
  var form=root.querySelector('form'), text=root.querySelector('textarea'), file=root.querySelector('input[type=file]');
  var preview=root.querySelector('.pf-preview'), remove=root.querySelector('.pf-remove'), status=root.querySelector('.pf-status'), send=root.querySelector('.pf-send');
  if(typeof dialog.showModal!=='function')return;trigger.hidden=false;
  var reports=root.querySelector('.pf-reports'), csrf='', requestId='', image=null, generation=0, loading=false, pending=null;
  var commentError=root.querySelector('#pf-comment-error');
  function validateComment(){var valid=!!text.value.trim();commentError.textContent=valid?'':'Please add a few words before sending.';commentError.hidden=valid;if(valid)text.removeAttribute('aria-invalid');else text.setAttribute('aria-invalid','true');return valid;}
  text.addEventListener('invalid',function(){validateComment();});
  text.addEventListener('input',function(){if(!commentError.hidden)validateComment();});
  function message(s){status.textContent=s;}
  function sending(v){send.disabled=v;text.disabled=v;file.disabled=v;remove.disabled=v;}
  function resetImage(){generation++;image=null;loading=false;send.disabled=false;file.value='';preview.hidden=true;preview.removeAttribute('src');remove.hidden=true;}
  function post(path,data){return fetch('/product-feedback/'+path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-feedback-csrf':csrf},body:JSON.stringify(data)}).then(function(r){if(!r.ok) throw Error(r.status===429?'Please try again a little later.':'We could not save that yet. Your note is still here.');return r.json();},function(){throw Error('We could not save that yet. Your note is still here.');});}
  function history(items){reports.replaceChildren();items.forEach(function(item){var entry=document.createElement('div');entry.className='pf-report';var note=document.createElement('p');note.textContent=item.comment;var state=document.createElement('p');state.className='pf-quiet';state.textContent=({queued:'Received',reviewing:'Being reviewed',needs_input:'Waiting for more detail',ready:'Prepared for approval',released:'Released',closed:'Reviewed'})[item.state]||'Received';var del=document.createElement('button');del.type='button';del.textContent='Remove';del.addEventListener('click',function(){post('delete',{id:item.id}).then(load).catch(function(e){message(e.message);});});entry.append(note,state,del);if(item.state==='released'){var q=document.createElement('p');q.textContent='Did the change help?';entry.append(q);[true,false].forEach(function(v){var b=document.createElement('button');b.type='button';b.textContent=v?'Yes':'Not yet';b.setAttribute('aria-pressed',String(item.improved===v));b.addEventListener('click',function(){post('improved',{id:item.id,improved:v}).then(load).catch(function(e){message(e.message);});});entry.append(b);});}reports.append(entry);});}
  function load(){return fetch('/product-feedback/session',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(!r.ok)throw Error('Feedback is unavailable just now. Please try again.');return r.json();}).then(function(data){csrf=data.csrf;history(data.reports);});}
  trigger.addEventListener('click',function(){if(typeof dialog.showModal!=='function')return;dialog.showModal();text.focus();load().catch(function(e){message(e.message);});});
  close.addEventListener('click',function(){dialog.close();});dialog.addEventListener('close',function(){trigger.focus();});
  remove.addEventListener('click',resetImage);
  file.addEventListener('change',function(){resetImageData();var current=++generation;var f=file.files&&file.files[0];if(!f)return;if(!/^image\\/(png|jpeg|webp)$/.test(f.type)||f.size>8000000){file.value='';message('Choose a PNG, JPEG or WebP image under 8 MB.');return;}loading=true;send.disabled=true;var local=URL.createObjectURL(f), img=new Image();img.onload=function(){if(current!==generation){URL.revokeObjectURL(local);return;}try{var scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));var canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);var data=canvas.toDataURL('image/jpeg',0.8);if(data.length>1333350)throw Error();image={type:'image/jpeg',data:data.split(',')[1]};preview.src=data;preview.hidden=false;remove.hidden=false;message('');}catch(e){file.value='';image=null;message('That image could not be attached. Try a smaller screenshot.');}finally{URL.revokeObjectURL(local);loading=false;send.disabled=false;}};img.onerror=function(){URL.revokeObjectURL(local);if(current!==generation)return;loading=false;send.disabled=false;file.value='';message('That image could not be opened.');};img.src=local;});
  function resetImageData(){image=null;preview.hidden=true;remove.hidden=true;}
  form.addEventListener('submit',function(e){e.preventDefault();if(!validateComment()){text.focus();return;}if(loading)return;if(!csrf){message('Please reopen feedback and try again.');return;}requestId=requestId||(crypto.randomUUID?crypto.randomUUID():([1e7]+'-'+1e3+'-'+4e3+'-'+8e3+'-'+1e11).replace(/[018]/g,function(c){return(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16);}));sending(true);var payload={requestId:requestId,comment:text.value,page:location.pathname,viewport:innerWidth+'x'+innerHeight};if(image)payload.image=image;if(pending&&pending.comment===text.value&&JSON.stringify(pending.image)===JSON.stringify(image||undefined))payload=pending;else{if(pending){requestId=crypto.randomUUID();payload.requestId=requestId;}pending=payload;}post('reports',payload).then(function(){text.value='';resetImage();requestId='';pending=null;message('Thank you. Your feedback is saved.');return load();}).catch(function(e){message(e.message);}).finally(function(){sending(false);});});
})();`;

export const feedbackScriptHash = createHash('sha256').update(FEEDBACK_WIDGET_SCRIPT).digest('base64');
