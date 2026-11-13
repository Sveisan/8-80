import { BRAND_HEAD } from './head.ts';
import { button, field, notice } from './components.ts';
import { FOUNDATION_CSS, CONTROL_CSS, LAYOUT_CSS } from './styles.ts';
import { palette, space, themes } from './tokens.ts';
import { BUSY_CSS, MOTION, mascot } from '../signup/mascot.ts';

const navigation = [
  ['retning', 'Retning'], ['farger', 'Farger'], ['typografi', 'Typografi'],
  ['rytme', 'Rom og rytme'], ['komponenter', 'Komponenter'],
  ['monstre', 'Sidemønstre'], ['tilgjengelighet', 'Tilgjengelighet'], ['vekst', 'Videre vekst'], ['merkevarefiler', 'Merkevarefiler'],
];

const sectionHeading = (number: string, title: string, lead: string): string =>
  `<div class="section-head"><span class="section-number">${number}</span><div><h2>${title}</h2><p>${lead}</p></div></div>`;

const choices = (name: string, labels: string[], chosen: number): string => labels.map((label, index) =>
  `<label class="pick"><input type="radio" name="${name}" value="${index}"${index === chosen ? ' checked' : ''}><span>${label}</span></label>`).join('');

/** A living handbook, built from the same tokens and controls as the product. */
export function designGuide(previewLinks = false): string {
  return `<!doctype html>
<html lang="nb" data-theme="dark"><head>${BRAND_HEAD}<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>8&80 · Designsystem</title>
<style>${FOUNDATION_CSS}${CONTROL_CSS}${LAYOUT_CSS}${BUSY_CSS}
  body { padding: 0; }
  .guide-header { display:flex; align-items:center; justify-content:space-between; gap:var(--space-4); min-height:6rem; border-bottom:1px solid var(--line); }
  .guide-brand { display:flex; align-items:center; gap:var(--space-4); text-decoration:none; color:var(--ink); }
  .guide-brand svg { width:3.25rem; height:auto; }
  .guide-brand strong { font:500 1.5rem var(--font-display); }
  .guide-brand span { border-left:1px solid var(--line); padding-left:var(--space-4); color:var(--quiet); font-size:var(--text-caption); }
  .theme-switch { display:flex; gap:var(--space-1); }
  .theme-switch button { min-height:var(--target-min); padding:var(--space-2) var(--space-4); font-size:var(--text-caption); border-color:transparent; }
  .theme-switch [aria-pressed="true"] { color:var(--on-accent); background:var(--accent); border-color:var(--accent); }
  .guide-hero { display:grid; grid-template-columns:minmax(0,1.7fr) minmax(0,1fr); gap:var(--space-12); padding:var(--space-24) 0 var(--space-16); align-items:center; }
  .version { display:inline-flex; align-items:center; gap:var(--space-2); font-size:var(--text-caption); color:var(--quiet); }
  .version::before { content:''; width:.5rem; height:.5rem; border-radius:50%; background:var(--gold); }
  .guide-hero h1 { font:500 var(--text-display)/var(--leading-display) var(--font-display); letter-spacing:-.035em; margin:var(--space-5) 0 var(--space-6); }
  .guide-hero h1 em { font-style:normal; color:var(--link); }
  .hero-lead { color:var(--quiet); max-width:35rem; margin:0; }
  .hero-seal { padding:var(--space-8); text-align:center; }
  .hero-seal .forever { display:block; width:100%; height:auto; margin-bottom:var(--space-6); }
  .hero-seal p { font-size:var(--text-caption); color:var(--quiet); margin:0; }
  .guide-meta { display:flex; flex-wrap:wrap; gap:var(--space-3) var(--space-8); padding:var(--space-5) 0; border-block:1px solid var(--line); font-size:var(--text-caption); color:var(--quiet); }
  .guide-meta strong { color:var(--ink); font-weight:500; }
  .guide-layout { display:grid; grid-template-columns:12rem minmax(0,1fr); gap:var(--space-12); margin-top:var(--space-16); }
  .guide-nav { position:sticky; top:var(--space-8); align-self:start; }
  .guide-nav p { font-size:var(--text-caption); color:var(--quiet); margin:0 0 var(--space-4); }
  .guide-nav a { display:flex; gap:var(--space-3); align-items:center; min-height:var(--target-min); color:var(--quiet); text-decoration:none; font-size:var(--text-caption); }
  .guide-nav a:hover { color:var(--ink); }
  .guide-nav a span { font-family:var(--font-mono); opacity:.65; font-size:.75rem; }
  .guide-content { min-width:0; }
  .guide-section { padding-bottom:var(--space-16); margin-bottom:var(--space-16); border-bottom:1px solid var(--line); scroll-margin-top:var(--space-8); }
  .section-head { display:flex; align-items:baseline; gap:var(--space-4); margin-bottom:var(--space-8); }
  .section-number { font:400 var(--text-caption) var(--font-mono); color:var(--link); }
  .section-head h2 { margin:0 0 var(--space-3); font-size:var(--text-heading); font-weight:500; letter-spacing:-.025em; }
  .section-head p { margin:0; color:var(--quiet); max-width:36rem; }
  .guide-content h3 { font-size:var(--text-subhead); margin:0 0 var(--space-3); }
  .guide-content h4 { margin:0 0 var(--space-3); font-size:var(--text-small); font-weight:600; }
  .guide-content .ds-panel > p:last-child { margin-bottom:0; }
  .principles { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--space-6); }
  .principle { padding-top:var(--space-5); border-top:2px solid var(--accent); }
  .principle p { font-size:var(--text-small); color:var(--quiet); }
  .audit-note { margin-top:var(--space-8); padding:var(--space-6); background:var(--card); border-radius:var(--radius-panel); }
  .audit-note p { color:var(--quiet); margin:var(--space-2) 0 0; font-size:var(--text-small); }
  .swatches { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--space-4); margin-bottom:var(--space-8); }
  .swatch { overflow:hidden; border:1px solid var(--line); border-radius:var(--radius-control); }
  .swatch-color { min-height:6.5rem; display:flex; align-items:flex-end; padding:var(--space-4); font:500 1.5rem var(--font-display); }
  .swatch-info { display:flex; flex-wrap:wrap; justify-content:space-between; gap:var(--space-1); padding:var(--space-3); font-size:var(--text-caption); }
  code { font:400 .75rem/1.6 var(--font-mono); overflow-wrap:anywhere; }
  .swatch-info code { color:var(--quiet); }
  .table-wrap { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; font-size:var(--text-caption); text-align:left; }
  th { color:var(--quiet); font-weight:500; }
  th, td { padding:var(--space-4) var(--space-3); border-bottom:1px solid var(--line); vertical-align:top; }
  th:first-child,td:first-child { padding-left:0; }
  .table-note { color:var(--quiet); font-size:var(--text-caption); margin-top:var(--space-4); }
  .type-specimen { padding:var(--space-8); background:var(--card); border:1px solid var(--line); border-radius:var(--radius-panel); margin-bottom:var(--space-6); }
  .type-specimen .display { font:500 clamp(2.75rem,5vw,4rem)/1.1 var(--font-display); letter-spacing:-.03em; margin:var(--space-3) 0 var(--space-5); }
  .type-specimen .body { max-width:29rem; margin:0; }
  .type-row { display:grid; grid-template-columns:6.5rem minmax(0,1fr) 7rem; align-items:baseline; gap:var(--space-4); padding:var(--space-5) 0; border-bottom:1px solid var(--line); }
  .type-row > span { font-size:var(--text-caption); color:var(--quiet); }
  .type-row p { margin:0; }
  .type-row .display-sample { font:500 2.5rem/1.1 var(--font-display); }
  .space-scale { display:flex; align-items:flex-end; gap:var(--space-4); padding:var(--space-6); background:var(--card); border-radius:var(--radius-panel); overflow-x:auto; }
  .space-item { display:flex; flex-direction:column; align-items:center; gap:var(--space-3); flex:1; min-width:2.4rem; font:400 .75rem var(--font-mono); color:var(--quiet); }
  .space-item i { display:block; width:100%; max-width:2.5rem; background:var(--accent); border-radius:3px; }
  .rule-grid { margin-top:var(--space-6); }
  .rule-grid p { font-size:var(--text-small); color:var(--quiet); }
  .component-block { padding:var(--space-6) 0; border-top:1px solid var(--line); }
  .component-block:first-of-type { border-top:0; padding-top:0; }
  .component-block > p { color:var(--quiet); font-size:var(--text-small); margin:0 0 var(--space-5); }
  .component-demo { padding:var(--space-6); background:var(--card); border:1px solid var(--line); border-radius:var(--radius-panel); }
  .button-caption { display:flex; flex-direction:column; gap:var(--space-2); align-items:flex-start; }
  .button-caption > span { color:var(--quiet); font-size:var(--text-caption); }
  .component-demo fieldset { margin:0; }
  .component-demo legend { margin-bottom:var(--space-4); }
  .sample-days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:var(--space-2); margin-bottom:var(--space-5); }
  .sample-times { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:var(--space-2); }
  .component-demo .notice { margin:0; }
  .component-demo .notice + .notice { margin-top:var(--space-4); }
  .sample-details { border-bottom:1px solid var(--line); }
  .sample-details summary { display:flex; align-items:center; justify-content:space-between; gap:var(--space-4); padding:var(--space-4) 0; list-style:none; }
  .sample-details summary::-webkit-details-marker { display:none; }
  .sample-details summary::after { content:'+'; color:var(--quiet); }
  .sample-details[open] summary::after { content:'−'; }
  .sample-details p { color:var(--quiet); font-size:var(--text-small); margin:0 0 var(--space-5); }
  .mark-moods { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:var(--space-5); text-align:center; }
  .mark-moods svg { width:100%; max-width:5rem; height:auto; margin:var(--space-4) auto; display:block; }
  .mark-moods span { font-size:var(--text-caption); color:var(--quiet); }
  .theme-pair { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-5); }
  .brand-gallery { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr)); gap:var(--space-5); }
  .brand-file { margin:0; border:1px solid var(--line); border-radius:var(--radius-control); overflow:hidden; }
  .brand-preview { padding:var(--space-6); min-height:9rem; display:flex; align-items:center; justify-content:center; }
  .brand-preview img { display:block; max-width:100%; width:100%; height:auto; }
  .brand-file figcaption { padding:var(--space-4); font-size:var(--text-caption); }
  .brand-icons { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-6); padding:var(--space-6); margin-top:var(--space-6); border:1px solid var(--line); border-radius:var(--radius-control); }
  .brand-icons figure { margin:0; text-align:center; }
  .brand-icons img { display:block; margin:0 auto var(--space-3); }
  .brand-icons figcaption { font-size:var(--text-caption); color:var(--quiet); }
  .pattern { background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:var(--radius-panel); padding:var(--space-6); }
  .pattern-label { font-size:var(--text-caption); color:var(--quiet); margin:0 0 var(--space-6); }
  .pattern h3 { font:500 1.8rem/1.2 var(--font-display); margin:0 0 var(--space-3); }
  .pattern p { font-size:var(--text-small); }
  .pattern .button { width:100%; }
  .call-card { border-top:2px solid var(--accent); padding-top:var(--space-5); margin:var(--space-6) 0; }
  .call-card strong { display:block; font-size:2.75rem; line-height:1.2; font-weight:600; font-variant-numeric:tabular-nums; letter-spacing:-.025em; }
  .pattern .mini-mark { width:3rem; height:auto; margin-bottom:var(--space-5); display:block; }
  .pattern blockquote { margin:var(--space-6) 0; padding:0; font:400 1.75rem/1.4 var(--font-body); }
  .pattern footer { border-top:1px solid var(--line); padding-top:var(--space-4); font-size:var(--text-caption); }
  .pattern-links { margin-top:var(--space-6); }
  .pattern-links a { min-height:var(--target-min); display:inline-flex; align-items:center; font-size:var(--text-caption); }
  .checks { padding:0; list-style:none; margin:0; }
  .checks li { padding:var(--space-5) 0; border-bottom:1px solid var(--line); display:grid; grid-template-columns:2rem 1fr; gap:var(--space-3); }
  .checks li > span { color:var(--link); font:400 var(--text-caption) var(--font-mono); padding-top:.2rem; }
  .checks strong { display:block; font-weight:600; margin-bottom:var(--space-2); }
  .checks p { margin:0; font-size:var(--text-small); color:var(--quiet); }
  .architecture { display:grid; gap:var(--space-3); counter-reset:layer; }
  .architecture > div { display:grid; grid-template-columns:2rem 9rem minmax(0,1fr); gap:var(--space-4); padding:var(--space-5); border:1px solid var(--line); border-radius:var(--radius-control); }
  .architecture span { color:var(--link); font:400 var(--text-caption) var(--font-mono); }
  .architecture strong { font-weight:600; font-size:var(--text-small); }
  .architecture p { margin:0; font-size:var(--text-small); color:var(--quiet); }
  .guide-footer { padding:0 0 var(--space-12); display:flex; justify-content:space-between; gap:var(--space-4); flex-wrap:wrap; color:var(--quiet); font-size:var(--text-caption); }
  .skip-link { position:absolute; top:-10rem; left:var(--space-5); z-index:2; padding:var(--space-3); background:var(--accent); color:var(--on-accent); }
  .skip-link:focus { top:var(--space-4); }
  @media(max-width:60rem) { .guide-layout{grid-template-columns:1fr;gap:var(--space-8)}.guide-nav{position:static;display:flex;overflow-x:auto;gap:var(--space-5);padding-bottom:var(--space-4);border-bottom:1px solid var(--line)}.guide-nav p{display:none}.guide-nav a{white-space:nowrap}.guide-hero{padding-top:var(--space-16);gap:var(--space-6)}.principles{grid-template-columns:1fr}.hero-seal{padding:var(--space-4)} }
  @media(max-width:40rem) { .guide-brand span{display:none}.guide-header{min-height:5rem}.theme-switch button{padding-inline:var(--space-3)}.guide-hero{grid-template-columns:1fr;padding:var(--space-12) 0}.hero-seal{display:none}.guide-layout{margin-top:var(--space-8)}.guide-section{margin-bottom:var(--space-10);padding-bottom:var(--space-10)}.section-head{gap:var(--space-3)}.swatches{grid-template-columns:repeat(2,minmax(0,1fr))}.theme-pair{grid-template-columns:1fr}.type-row{grid-template-columns:1fr;gap:var(--space-2)}.type-specimen{padding:var(--space-6)}.component-demo{padding:var(--space-4)}.sample-days{gap:var(--space-1)}.architecture > div{grid-template-columns:1.5rem 1fr;gap:var(--space-2)}.architecture p{grid-column:2}.mark-moods{grid-template-columns:repeat(2,minmax(0,1fr))}.guide-meta{gap:var(--space-3) var(--space-5)} }
</style></head><body>
<a class="skip-link" href="#innhold">Hopp til innhold</a>
<div class="ds-container">
  <header class="guide-header"><a class="guide-brand" href="#topp" aria-label="8&80 designsystem">${mascot('rest')}<strong>8&80</strong><span>Designsystem</span></a>
    <div class="theme-switch" role="group" aria-label="Velg tema"><button type="button" data-set-theme="light" aria-pressed="false">Papir</button><button type="button" data-set-theme="dark" aria-pressed="true">Kveld</button></div>
  </header>
  <div class="guide-hero" id="topp"><div><span class="version">Fundament · versjon 1.0</span><h1>Litt perspektiv.<br><em>En tydelig helhet.</em></h1><p class="hero-lead">Ett felles formspråk for alt 8&80 blir. Laget for den første samtalen, det neste valget og tjenesten som vokser.</p></div><div class="hero-seal">${mascot('idle', 'forever')}<p>Én linje. To perspektiver.<br>Plass til et helt liv.</p></div></div>
  <div class="guide-meta"><span><strong>6</strong> merkevarefarger</span><span><strong>2</strong> temaer</span><span><strong>1</strong> felles komponentgrunnlag</span><span>Bygget på den eksisterende 8&80-identiteten</span></div>
  <div class="guide-layout"><nav class="guide-nav" aria-label="Innhold"><p>I håndboken</p>${navigation.map(([id,label],i)=>`<a href="#${id}"><span>${String(i+1).padStart(2,'0')}</span>${label}</a>`).join('')}</nav>
  <main class="guide-content" id="innhold">
  <section class="guide-section" id="retning">${sectionHeading('01','Oppmerksomhet, i alle detaljer.','Tjenesten lover en samtale fra noen som husker. Det løftet skal også være synlig mellom samtalene.')}
    <div class="principles"><article class="principle"><h3>Rolig</h3><p>Tydelig hierarki, rom rundt innholdet og ett naturlig neste steg. Bevegelse viser at noe skjer.</p></article><article class="principle"><h3>Personlig</h3><p>Varmt papir, en menneskelig serif og brukerens egne ord i sentrum. En oppsummering skal føles som et brev.</p></article><article class="principle"><h3>Direkte</h3><p>Knapper sier hva som skjer. Feil viser hvordan du kommer videre. Det skal være lett å flytte, pause og avslutte.</p></article></div>
    <div class="audit-note"><h4>Hva gjennomgangen avdekket</h4><p>Fire egne stilgrunnlag hadde ulike farger, radier og skjemaregler. Belief practice avvek fra merkevarepaletten. Fontene var beskrevet, men manglet. Systemet samler dette i ett fundament og gjør fokus, feil og kontrast konsekvent.</p></div>
  </section>
  <section class="guide-section" id="farger">${sectionHeading('02','Farger med faste roller.','Seks merkevarefarger. Komponentene bruker semantiske roller som tilpasser seg bakgrunnen.')}
    <div class="swatches">${Object.entries(palette).map(([name,hex])=>`<article class="swatch"><div class="swatch-color" style="background:${hex};color:${['night','pine','green'].includes(name)?palette.chalk:palette.night}">${name[0]!.toUpperCase()+name.slice(1)}</div><div class="swatch-info"><span>${name==='gold'?'Barnets nysgjerrighet':name==='pine'?'Tekst og handling':name==='night'?'Kveldens bakgrunn':name==='paper'?'Det personlige brevet':name==='chalk'?'Tekst på mørkt':'Lenker på lyst'}</span><code>${hex}</code></div></article>`).join('')}</div>
    <div class="table-wrap"><table><caption class="sr">Semantiske farger i lyst og mørkt tema</caption><thead><tr><th>Rolle</th><th>Papir</th><th>Kveld</th><th>Bruk</th></tr></thead><tbody>${[
      ['--bg','bg','Sidebakgrunn'],['--ink','ink','Overskrifter og brødtekst'],['--card','card','Grupper og paneler'],['--quiet','quiet','Hjelpetekst og metadata'],['--accent','accent','Primærhandling og valgt tilstand'],['--on-accent','on-accent','Tekst på primærhandling'],['--link','link','Lenker i løpende tekst'],['--control-border','control-border','Avgrensning av skjemafelt'],['--bad','bad','Feil og destruktive handlinger'],
    ].map(([token,key,use])=>`<tr><td><code>${token}</code></td><td><code>${themes.light[key as keyof typeof themes.light]}</code></td><td><code>${themes.dark[key as keyof typeof themes.dark]}</code></td><td>${use}</td></tr>`).join('')}</tbody></table></div>
    <p class="table-note">Gull brukes på mørk bakgrunn. På papir brukes Pine til primærhandlinger og Green til lenker. Feil har en egen funksjonsfarge og forklares alltid i tekst.</p>
  </section>
  <section class="guide-section" id="typografi">${sectionHeading('03','En menneskelig stemme.','Fraunces gir hovedbudskapet karakter. Bricolage Grotesque gjør resten lett å lese og bruke.')}
    <div class="type-specimen"><span class="eyebrow">Fraunces + Bricolage Grotesque</span><p class="display">Two mentors.<br>Both of them you.</p><p class="body">A weekly accountability call with your eight- and eighty-year-old selves.</p></div>
    ${[
      ['Display','A little perspective.','44–72 / 500','display-sample'],['Sidetittel','Your calls','28–36 / 500',''],['Seksjon','Your next conversation','21 / 700',''],['Brødtekst','Make a little room for yourself.','18 / 400',''],['Hjelpetekst','Shown in your local time.','14 / 400',''],
    ].map(([name,sample,meta,cls],i)=>`<div class="type-row"><span>${name}</span><p class="${cls}" style="${i===1?'font:500 var(--text-heading)/1.15 var(--font-display)':i===2?'font-size:var(--text-subhead);font-weight:700':i===4?'font-size:var(--text-caption);color:var(--quiet)':''}">${sample}</p><span>${meta}</span></div>`).join('')}
    <p class="table-note">Størrelser i px ved standard tekstinnstilling. Brødtekst har linjehøyde 1,6. Begge skrifter ligger lokalt, med støtte for æ, ø og å. E-post bruker en systemfont. Setningskasus i alle grensesnitt.</p>
  </section>
  <section class="guide-section" id="rytme">${sectionHeading('04','Rom som gir innholdet ro.','En skala på fire piksler gjør at nye sider får samme rytme uten at alle avstander må vurderes på nytt.')}
    <div class="space-scale">${Object.entries(space).filter(([key])=>Number(key)<=16).map(([key,value])=>`<div class="space-item"><i style="height:${value}"></i><span>${Number(key)*4}</span></div>`).join('')}</div>
    <div class="ds-grid rule-grid"><article class="ds-panel"><h3>Tre bredder</h3><p>Skjema: <strong>28 rem</strong><br>Lesing: <strong>42 rem</strong><br>Oversikt: <strong>72 rem</strong></p><p>Mobil får én kolonne og 20 px sidemarg. Innholdet bestemmer når et rutenett brytes.</p></article><article class="ds-panel"><h3>To former</h3><p>Felt og knapper: <strong>12 px</strong><br>Paneler: <strong>24 px</strong></p><p>Strukturer bygges med flater og tynne linjer. Skygger og ekstra dekor legges ikke til som standard.</p></article></div>
  </section>
  <section class="guide-section" id="komponenter">${sectionHeading('05','Små deler. Samme oppførsel.','Dette er fungerende komponenter fra kodegrunnlaget. Du kan endre valg, åpne spørsmål og prøve tastaturet.')}
    <div class="component-block"><h3>Handlinger</h3><p>Én primærhandling per oppgave. Sekundærhandlinger gir valgfrihet. Destruktive valg har presise navn og et eget bekreftelsessteg.</p><div class="component-demo ds-cluster">${[
      [button('Save my time',{type:'button'}),'Primær'],[button('Choose another time',{type:'button',variant:'secondary'}),'Sekundær'],[button('Back',{type:'button',variant:'quiet'}),'Rolig'],[button('Delete my account',{type:'button',variant:'danger'}),'Destruktiv · eksempel'],[button('Continue',{type:'button',disabled:true}),'Utilgjengelig'],[button('Saving my time',{type:'button',loading:true}),'Arbeider'],
    ].map(([control,label])=>`<div class="button-caption">${control}<span>${label}</span></div>`).join('')}</div></div>
    <div class="component-block"><h3>Skjemafelt</h3><p>Etiketten blir stående når feltet fylles ut. Hjelpetekst og feil er knyttet til feltet, også for skjermlesere.</p><div class="component-demo">${field({id:'demo-name',label:'What shall we call you?',value:'Alex',hint:'Use the name you want to hear on the call.',autocomplete:'given-name'})}${field({id:'demo-email',label:'Email',type:'email',value:'alex@',error:'Enter an email address, such as alex@example.com.'})}${field({id:'demo-disabled',label:'Phone number',type:'tel',value:'+47 900 00 000',disabled:true,hint:'Unavailable while the change is being saved.'})}</div></div>
    <div class="component-block"><h3>Dag og tidspunkt</h3><p>Samme kontroll ved påmelding og når en samtale flyttes. Valgene er vanlige radioknapper med støtte for piltaster.</p><div class="component-demo"><fieldset><legend>When suits you?</legend><div class="sample-days">${choices('demo-day',['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],3)}</div></fieldset><fieldset><legend>Choose a time</legend><div class="sample-times">${choices('demo-time',['17:00','17:15','17:30','17:45'],2)}</div></fieldset></div></div>
    <div class="component-block"><h3>Tilbakemeldinger</h3><p>En rolig beskjed bekrefter resultatet. En feil forklarer hva brukeren kan gjøre videre. Vi legger ikke til poeng, konfetti eller ros for å møte opp.</p><div class="component-demo">${notice('Your weekly call is now on Thursday at 17:30.')}${notice('That time has passed. Choose a later time to keep your first call this week.','alert')}</div></div>
    <div class="component-block"><h3>Innhold som kan vente</h3><p>Spørsmål og valg som bare noen trenger, åpnes på forespørsel.</p><div class="component-demo"><details class="sample-details"><summary>What if the time stops suiting me?</summary><p>Open Your calls to move one call or change your usual time.</p></details><details class="sample-details"><summary>Who’s on the other end?</summary><p>An AI voice, guided by two perspectives: your eight-year-old and your eighty-year-old selves.</p></details></div></div>
    <div class="component-block"><h3>Merket i bevegelse</h3><p>De to løkkene bytter størrelse. Gull følger den lille løkken. Redusert bevegelse gir et komplett, stillestående merke.</p><div class="component-demo mark-moods">${[['rest','I ro'],['idle','Tilstede'],['wait','Arbeider'],['nudge','Din tur']].map(([mood,label])=>`<div>${mascot(mood as 'rest'|'idle'|'wait'|'nudge')}<span>${label}</span></div>`).join('')}</div></div>
  </section>
  <section class="guide-section" id="monstre">${sectionHeading('06','Ett system. Ulike situasjoner.','Påmelding forklarer. Kundesiden hjelper deg å handle. Brevet gir plass til dine egne ord.')}
    <div class="theme-pair"><article class="pattern" data-theme="dark"><p class="pattern-label">Kundeside · kveld</p>${mascot('rest','mini-mark')}<h3>Your calls</h3><p class="quiet">A little room for yourself, every week.</p><div class="call-card"><p class="quiet">Your next conversation</p><p>Thursday 12 November</p><strong>17:30</strong><p class="quiet">Norwegian time</p></div><button class="primary" type="button">Move this call</button><p class="quiet">Eksempel på hierarki. Ingen samtale flyttes her.</p></article><article class="pattern" data-theme="light"><p class="pattern-label">Oppsummering · papir</p>${mascot('rest','mini-mark')}<h3>One thing for this week.</h3><p class="quiet">12 November</p><blockquote>“I’ll make room for one evening without plans.”</blockquote><p>Your own words, kept somewhere you can come back to.</p><footer>— 8&80</footer></article></div>
    <div class="table-wrap" style="margin-top:var(--space-8)"><table><caption class="sr">Mønstre for hele tjenesten</caption><thead><tr><th>Flate</th><th>Hovedoppgave</th><th>Mønster</th></tr></thead><tbody><tr><td>Påmelding</td><td>Forstå og bestille</td><td>Introduksjon + skjema. To kolonner når det er plass.</td></tr><tr><td>Tilgang og kode</td><td>Bekrefte hvem du er</td><td>Smal side, synlig etikett, ett neste steg.</td></tr><tr><td>Samtaler og konto</td><td>Se neste avtale</td><td>Avtalen først. Endringer og avslutning er tydelig navngitt.</td></tr><tr><td>Mål og hukommelse</td><td>Rette egne opplysninger</td><td>Lesbare tekstfelt, forklaring og lagring.</td></tr><tr><td>Tilbakemelding</td><td>Fortelle om opplevelsen</td><td>Spørsmål med lik visuell vekt og store tekstfelt.</td></tr><tr><td>Belief practice</td><td>Forberede og øve</td><td>Samme tokens og kontroller. Egen oppgavestruktur.</td></tr><tr><td>Unblock</td><td>Følge ønsker og små steg</td><td>Samme programgrunnlag, synlige valg og brukerens egne ord.</td></tr><tr><td>Vilkår og personvern</td><td>Finne og lese</td><td>Lesebredde, tydelige mellomtitler og understrøkne lenker.</td></tr></tbody></table></div>
    ${previewLinks ? '<div class="pattern-links ds-cluster" aria-label="Lokale produktsider"><a href="/start">Se påmeldingen →</a><a href="/me">Se kundesiden →</a><a href="/memory">Se mål og hukommelse →</a><a href="/feedback">Se tilbakemelding →</a><a href="/beliefs">Se Belief practice →</a><a href="/unblock">Se Unblock →</a></div>' : ''}
    <p class="table-note">Illustrasjonene viser sidemønstre. Det faktiske e-postoppsettet følger fortsatt brevreglene i BRAND.md og bruker e-postsikre systemfonter.</p>
  </section>
  <section class="guide-section" id="tilgjengelighet">${sectionHeading('07','Tydelig, også når det er vanskelig.','Tilgjengelighet ligger i grunnkomponentene og kontrolleres på alle nye sider.')}
    <ol class="checks"><li><span>01</span><div><strong>Lesbar kontrast</strong><p>Tekst, hjelpetekst, lenker og feil skal ha minst 4,5:1 mot flaten. Feltavgrensning og fokus skal ha minst 3:1.</p></div></li><li><span>02</span><div><strong>Tastatur og tommel</strong><p>Synlig fokus på alle handlinger. Kontroller er minst 48 px høye, diskrete handlinger minst 44 px. Radiovalg bruker piltaster.</p></div></li><li><span>03</span><div><strong>Feil som viser veien videre</strong><p>Etikett, forklaring og feil knyttes sammen. Farge er aldri eneste signal. Ingen innhold forsvinner når felt fylles ut.</p></div></li><li><span>04</span><div><strong>Plass til større tekst</strong><p>Relative størrelser, fleksible kolonner og tydelig leserekkefølge. Test ved 320 px og med 200 % tekstforstørrelse.</p></div></li><li><span>05</span><div><strong>Respekt for ro og forbindelse</strong><p>Redusert bevegelse stopper animasjon. Grunnoppgaver fungerer som vanlige HTML-skjemaer. Fontene lastes fra tjenestens eget domene.</p></div></li></ol>
  </section>
  <section class="guide-section" id="vekst">${sectionHeading('08','Voks gjennom gjenbruk.','Start med det systemet allerede kan. En ny funksjon skal trenge færre nye designvalg enn den forrige.')}
    <div class="architecture"><div><span>01</span><strong>Tokens</strong><p>Farger, tekstskala, avstand, bredde, form og bevegelse. Én kilde i tokens.ts.</p></div><div><span>02</span><strong>Komponenter</strong><p>Felt, handlinger, radiovalg, beskjeder og disclosure. Samme tilstander overalt.</p></div><div><span>03</span><strong>Sidemønstre</strong><p>Bestille, bekrefte, lese, redigere og avslutte. Innhold og oppgave bestemmer oppsettet.</p></div><div><span>04</span><strong>Tjenester</strong><p>Ukentlige samtaler, Belief practice, Unblock og senere tilbud deler fundamentet.</p></div></div>
    <div class="audit-note"><h4>Når en ny komponent trengs</h4><p>Beskriv behovet. Kontroller om eksisterende deler kan løse det. Definer mobil, tastatur, tom, feil, valgt og ventende tilstand. Legg eksemplet i denne håndboken og verifiser begge temaer før komponenten tas i bruk.</p></div>
    <p class="table-note">Komponentene bruker systemets fargeroller og innfødte HTML-elementer. Ingen ny frontendplattform kreves. Tekniske regler, revisjonsfunn og innføringsplan finnes i docs/design-system.md.</p>
  </section>
  <section class="guide-section" id="merkevarefiler">${sectionHeading('09','Klar i alle størrelser.','Ferdige originaler for nettsiden, snarveien på hjemskjermen og neste flate. Ordmerket er gjort om til vektorbaner og trenger ingen font.')}
    <div class="brand-gallery">
      ${[['light','Papir',palette.paper],['dark','Kveld',palette.night],['on-gold','Gull',palette.gold]].map(([variant,label,bg]) => `<figure class="brand-file"><div class="brand-preview" style="background:${bg}"><img src="/brand/lockup-${variant}.svg" alt="8&amp;80-logo på ${label!.toLowerCase()}" width="238" height="96"></div><figcaption><a href="/brand/lockup-${variant}.svg" download>Logo · ${label}</a></figcaption></figure>`).join('')}
    </div>
    <div class="brand-icons"><figure><img src="/brand/icon-192.png" width="96" height="96" alt="8&amp;80-appikon med mørk bakgrunn"><figcaption>Appikon · Night</figcaption></figure><figure><img src="/brand/favicon.svg" width="48" height="48" alt="8&amp;80-favicon med lys bakgrunn"><figcaption>Favicon · Paper</figcaption></figure><div><h3>Ett merke, tilpasset flaten.</h3><p class="table-note">Appikonet har en heldekkende bakgrunn og sikker plass til maskering. Favicon bruker den kraftigere småformattegningen. Begge er statiske.</p></div></div>
    <p class="table-note">SVG-logoer, SVG og ICO favicon, PNG i 16, 32, 48, 180, 192 og 512 px, samt webmanifest ligger i brand/assets/. Bruk originalene uten å endre proporsjoner. Bygg og filkontroll: <code>npm run design:build</code> og <code>npm run design:check</code>.</p>
  </section>
  </main></div>
  <footer class="guide-footer"><span>8&80 · Designsystem 1.0</span><span>Én linje. To perspektiver. Et felles fundament.</span></footer>
</div>
<script>
  document.querySelectorAll('[data-set-theme]').forEach(function (button) {
    button.addEventListener('click', function () {
      document.documentElement.dataset.theme = button.dataset.setTheme;
      document.querySelectorAll('[data-set-theme]').forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
    });
  });
</script>${MOTION}
</body></html>`;
}
