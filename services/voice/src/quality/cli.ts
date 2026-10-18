import {readFile,stat} from 'node:fs/promises';
import {toTranscript} from '../webhook/speechify.ts';
import {weeklyQuality,type QualityContext} from './weekly.ts';
import {qualityFixtures} from './fixtures.ts';

const usage='Use quality:weekly (synthetic baseline), --file PATH [--context PATH], or --conversation ID [--context PATH]. Context is optional JSON with kind and priorCommitment from before this call. No provider requests or messages are made.';
async function readJson(path:string):Promise<unknown>{
  if((await stat(path)).size>2_000_000)throw Error('File exceeds the local review limit.');
  return JSON.parse(await readFile(path,'utf8')) as unknown;
}
function contextOf(v:unknown):QualityContext {
  if(!v || typeof v!=='object' || Array.isArray(v))throw Error('Invalid review context.');
  const c=v as Record<string,unknown>;
  if(!['first','return','unknown'].includes(String(c['kind'])) || c['priorCommitment']!==undefined && (typeof c['priorCommitment']!=='string' || c['priorCommitment'].length>2000))throw Error('Invalid review context.');
  return {kind:c['kind'] as QualityContext['kind'],...(typeof c['priorCommitment']==='string'?{priorCommitment:c['priorCommitment']}:{})};
}
try{
  const args=process.argv.slice(2);const opts=new Map<string,string>();
  if(args.includes('--help')){console.log(usage);process.exit(0);}
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    if(!key || !['--file','--conversation','--context'].includes(key) || !value || value.startsWith('--') || opts.has(key))throw Error('Invalid arguments.');
    opts.set(key,value);
  }
  if(opts.has('--file') && opts.has('--conversation') || opts.has('--context') && !opts.has('--file') && !opts.has('--conversation'))throw Error('Choose one review source.');
  const context=opts.has('--context')?contextOf(await readJson(opts.get('--context')!)):{kind:'unknown'} as const;
  if(!opts.has('--file') && !opts.has('--conversation')){
    console.log(JSON.stringify({source:'synthetic_only',cases:qualityFixtures.map(f=>({id:f.id,report:weeklyQuality(f.transcript,f.context)}))},null,2));
  }else if(opts.has('--file')){
    console.log(JSON.stringify({source:'local_file',report:weeklyQuality(toTranscript(await readJson(opts.get('--file')!)),context)},null,2));
  }else{
    const id=opts.get('--conversation')!;
    if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))throw Error('Invalid conversation identifier.');
    const [{config},{PostgresStore},{Deliveries}]=await Promise.all([import('../config.ts'),import('../store/postgres.ts'),import('../webhook/deliveries.ts')]);
    if(!config.database.url)throw Error('Database configuration is missing.');
    const store=new PostgresStore(config.database.url);
    try{
      const attempts=await store.raw`select a.id,s.id as belief_id from call_attempts a left join belief_sessions s on s.id=a.id where a.provider_call_id=${id}`;
      if(attempts.length!==1 || attempts[0]!['belief_id'])throw Error('No unambiguous weekly call is available for this identifier.');
      const delivery=await new Deliveries(store.raw).body(id);
      if(!delivery)throw Error('No retained delivery is available. This command does not fetch or retain older provider data.');
      console.log(JSON.stringify({source:'retained_weekly_webhook',report:weeklyQuality(toTranscript(JSON.parse(delivery.body)),context)},null,2));
    }finally{await store.close();}
  }
}catch{
  // JSON parse and provider/database errors can contain caller wording or
  // credentials. Never echo their message, input path or source contents.
  console.error('The local review could not be completed. Check the source, arguments and private configuration. No raw content or credentials were printed.');
  console.error(usage);process.exitCode=1;
}
