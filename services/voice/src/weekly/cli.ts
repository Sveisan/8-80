import { openDeps } from '../control.ts';
import { tipReport } from './tips.ts';
import { weeklyOpenApi } from './tool-schema.ts';

try {
  if(process.argv.includes('--openapi')) console.log(JSON.stringify(weeklyOpenApi(),null,2));
  else {
    const deps=openDeps();
    try { console.log(JSON.stringify(await tipReport(deps.store.raw),null,2)); }
    finally { await deps.store.close(); }
  }
} catch {
  console.error('Could not read the weekly tip report or tool schema. Check the database migration and PUBLIC_URL configuration.');
  process.exitCode=1;
}
