import { beliefConfig } from './config.ts';
import { beliefReadiness } from './readiness.ts';
const missing=beliefReadiness();
console.log('8&80 Beliefs readiness — configuration values are never printed');
console.log('Pricing: one-time purchase matching one base monthly payment; no renewal');
console.log(beliefConfig().live?'Live-call switch: ON':'Live-call switch: OFF');
if(missing.length){for(const item of missing)console.log('Required: '+item);process.exitCode=1;}
else console.log('Configuration gates present. Provider tests and staffed coverage still require operational verification.');
