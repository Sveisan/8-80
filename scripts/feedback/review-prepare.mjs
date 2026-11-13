import process from 'node:process';
import console from 'node:console';
import { materialize, readRequest } from './contract.mjs';
try {materialize(process.env.FEEDBACK_RESULT??'',readRequest());console.log('Candidate prepared for a separate read-only review.');}
catch {console.error('Candidate could not be prepared for review.');process.exitCode=1;}
