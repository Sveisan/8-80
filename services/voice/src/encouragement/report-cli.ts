import { openDeps } from '../control.ts';
import { encouragementReport } from './report.ts';
const deps=openDeps();
try{console.log(JSON.stringify(await encouragementReport(deps.store.raw),null,2));}
finally{await deps.store.close();}
