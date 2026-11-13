import process from 'node:process';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { api, clearPrivate, CODE_REPOSITORY, materialize, parseResult, readRequest, updateReport } from './contract.mjs';
try {
  const request=readRequest();
  const result=parseResult(process.env.FEEDBACK_RESULT??'');
  const review=JSON.parse(process.env.FEEDBACK_REVIEW??'{}');
  if(result.status!=='ready'||review.approved!==true) {await updateReport(request,'needs_input');console.log('A person must review the report; no code was published.');}
  else {
    const {paths}=materialize(process.env.FEEDBACK_RESULT,request);
    const token=process.env.FEEDBACK_CODE_TOKEN;
    if(!token)throw Error();
    const prefix=`/repos/${CODE_REPOSITORY}`;
    const branch=`codex/feedback-${request.id}`;
    const privateRepo=await api(`/repos/${process.env.GITHUB_REPOSITORY}`,process.env.GITHUB_TOKEN);
    if(privateRepo.private!==true)throw Error();
    const existing=await api(`${prefix}/pulls?state=all&head=${encodeURIComponent(`Sveisan:${branch}`)}`,token);
    let pr=existing[0];
    const base=await api(`${prefix}/git/commits/${request.base}`,token);
    const tree=[];
    for(const path of paths){const blob=await api(`${prefix}/git/blobs`,token,{method:'POST',body:JSON.stringify({content:readFileSync(path,'utf8'),encoding:'utf-8'})});tree.push({path,mode:'100644',type:'blob',sha:blob.sha});}
    const next=await api(`${prefix}/git/trees`,token,{method:'POST',body:JSON.stringify({base_tree:base.tree.sha,tree})});
    if(!pr) {
      const commit=await api(`${prefix}/git/commits`,token,{method:'POST',body:JSON.stringify({message:`Improve interface from feedback ${request.id.slice(0,8)}`,tree:next.sha,parents:[request.base]})});
      // Reconcile a lost response without resetting a branch somebody may be reviewing.
      const refs=await api(`${prefix}/git/matching-refs/heads/${branch}`,token);
      const ref=refs.find(r=>r.ref===`refs/heads/${branch}`);
      if(ref) {
        const previous=await api(`${prefix}/git/commits/${ref.object.sha}`,token);
        if(previous.tree.sha!==next.sha || previous.parents.length!==1 || previous.parents[0].sha!==request.base)throw Error();
      } else await api(`${prefix}/git/refs`,token,{method:'POST',body:JSON.stringify({ref:`refs/heads/${branch}`,sha:commit.sha})});
      pr=await api(`${prefix}/pulls`,token,{method:'POST',body:JSON.stringify({base:request.branch,head:branch,draft:false,title:`Improve interface from feedback ${request.id.slice(0,8)}`,
        body:`An interface improvement prepared from a private product report. The original comment and screenshot are not published.\n\nThe candidate passed scope/privacy checks, the application check suite, browser checks and an independent automated review. Review the diff and CI evidence before merging.\n\nManual approval is required. After reviewing and merging, use the normal production release process; this automation cannot merge or deploy.\n\n<!-- product-feedback:${request.id} -->\n`})});
    }
    if(pr.state!=='open'||pr.merged_at)throw Error();
    if(pr.head?.ref!==branch || pr.head?.repo?.full_name!==CODE_REPOSITORY || pr.base?.ref!==request.branch)throw Error();
    const published=await api(`${prefix}/git/commits/${pr.head.sha}`,token);
    if(published.tree.sha!==next.sha || published.parents.length!==1 || published.parents[0].sha!==request.base)throw Error();
    await updateReport(request,'ready',pr.number);
    await api(`/repos/${process.env.GITHUB_REPOSITORY}/issues/${request.issue}/comments`,process.env.GITHUB_TOKEN,{method:'POST',body:JSON.stringify({body:`Prepared change: ${pr.html_url}\n\nAwaiting manual approval. Original feedback remains private.`})});
    console.log('A reviewable pull request is ready. No merge or deployment was requested.');
  }
}catch{console.error('Feedback publication did not complete. Reconcile the existing branch/PR before retrying; do not reset its reference.');process.exitCode=1;}
finally{clearPrivate();}
