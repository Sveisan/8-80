import process from 'node:process';
import console from 'node:console';
import { clearPrivate, readRequest, updateReport } from './contract.mjs';
try {await updateReport(readRequest(),'needs_input');console.log('A person needs to review this report. Nothing was merged or deployed.');}
catch {console.error('Report status could not be updated. Check the private run and reconcile it manually.');process.exitCode=1;}
finally {clearPrivate();}
