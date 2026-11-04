import {useEffect,useRef,useState} from "preact/hooks";
import {makeId,verifiedHorizon,type DialTask,type DialCallView,type DialJob,type DialBasis} from "@ra/core";
import {api} from "../../store/device";
import {store,localSession,checkLocalSession} from "../../store/db";
import {mind} from "../../store/mind";
import {useHorizon,refreshHorizon} from "../../store/horizon";
import {dialRequest,DIAL_PROBLEMS} from "../../store/dialWork";
import { InfoTip } from "../../ui/Tooltip";
interface Saved{operationId:string;kind:DialTask;callId:string|null;signalIds:string[]}
export function DialBasisView({basis}:{basis:DialBasis}){
  return <details style={{marginTop:"12px"}}><summary>Sources and uncertainty</summary><p class="meta">{basis.uncertainty}</p><p class="meta">Read {new Date(basis.asOf).toLocaleDateString("en-GB")}. This reading does not change your call.</p>{basis.evidence.map(citation=>{const source=basis.sources.find(source=>source.id===citation.signalId);return source&&<div class="hair" key={citation.signalId} style={{paddingTop:"10px",marginTop:"10px"}}><p>“{citation.quote}”</p>{source.sources.map(url=><a class="row" href={url} key={url} target="_blank" rel="noopener noreferrer" style={{overflowWrap:"anywhere",fontSize:"13px"}}>{url}</a>)}</div>})}</details>;
}
/** Inference starts only from a button. Encrypted request IDs support read-only resumption. */
export function DialWorkPanel({kind,call}:{kind:DialTask;call?:DialCallView}){
  const sharedHorizon=useHorizon(),[refreshedHorizon,setHorizon]=useState<ReturnType<typeof useHorizon>>(null),horizon=refreshedHorizon??sharedHorizon;
  const [session]=useState(()=>localSession()),[selection,setSelection]=useState<string[]>([]),[saved,setSaved]=useState<Saved|null>(null),[job,setJob]=useState<DialJob|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[problem,setProblem]=useState("");
  const action=useRef<AbortController|null>(null),latest=useRef<{saved:Saved|null;job:DialJob|null}>({saved:null,job:null});latest.current={saved,job};
  const key="dial.request:"+kind+":"+(call?.callId??"new")+":"+(call?.reviewAt??0);
  const sources=(horizon?.signals??[]).filter(source=>verifiedHorizon(source,Date.now())&&typeof source.at==="number"&&source.at<=Date.now()&&source.at>=Date.now()-30*86_400_000);
  useEffect(()=>{const controller=new AbortController(),cancelUrl=api("/dial/cancel");void(async()=>{try{const previous=await store.get<Saved>(key);checkLocalSession(session);controller.signal.throwIfAborted();if(previous){setSaved(previous);setSelection(previous.signalIds);const status=await dialRequest(session,"status",previous.operationId,{},controller.signal);setJob(status);if(status.state==="completed")await mind().sync()}}catch(error){if(!controller.signal.aborted)setProblem(error instanceof Error?error.message:"The saved request could not load.")}finally{if(!controller.signal.aborted)setLoading(false)}})();
    return()=>{controller.abort();action.current?.abort();const current=latest.current;if(current.saved&&(!current.job||current.job.state==="running"))void fetch(cancelUrl,{method:"POST",credentials:"include",keepalive:true,headers:{"content-type":"application/json","x-ra-account":session.owner},body:JSON.stringify({operationId:current.saved.operationId})}).catch(()=>{})};
  },[key]);
  useEffect(()=>{if(job?.state!=="running")return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const status=await dialRequest(session,"status",job.operationId,{},controller.signal);if(controller.signal.aborted)return;setJob(status);if(status.state==="running")timer=setTimeout(()=>void poll(),750);else if(status.state==="completed"){await mind().sync();checkLocalSession(session)}}catch(error){if(!controller.signal.aborted)setProblem(error instanceof Error?error.message:"The request could not be checked.")}};timer=setTimeout(()=>void poll(),500);return()=>{controller.abort();clearTimeout(timer)}},[job?.operationId,job?.state]);
  async function act(mode:"new"|"retry"|"cancel"|"refresh"|"status"){
    if(action.current)return;const controller=new AbortController();action.current=controller;setBusy(true);setProblem("");
    try{
      checkLocalSession(session);if(mode==="refresh"){const refreshed=await refreshHorizon();checkLocalSession(session);controller.signal.throwIfAborted();if(!refreshed)throw new Error("The Horizon could not refresh.");setHorizon(refreshed);setSelection([]);return}
      let request=saved;
      if(mode!=="cancel"&&mode!=="status"){
        const copy=mind();await copy.sync();checkLocalSession(session);controller.signal.throwIfAborted();
        if(copy.current.pending.some(edit=>["star.written","star.revised","markers.named","dial.call","dial.reviewed"].includes(edit.kind)))throw new Error("Your call and Chart edits must finish syncing before requesting a reading.");
      }
      if(mode==="new"){request={operationId:makeId(),kind,callId:call?.callId??null,signalIds:[...selection]};await store.set(key,request);checkLocalSession(session);controller.signal.throwIfAborted();setSaved(request);setJob(null);latest.current={saved:request,job:null}}
      if(!request)throw new Error("Start a Dial request first.");
      const status=await dialRequest(session,mode==="cancel"?"cancel":mode==="status"?"status":"generate",request.operationId,{...request,retry:mode==="retry"},controller.signal);setJob(status);latest.current={saved:request,job:status};
      if(status.state==="completed"){await mind().sync();checkLocalSession(session);controller.signal.throwIfAborted()}
    }catch(error){if(!controller.signal.aborted)setProblem(error instanceof Error?error.message:"This Dial request could not complete.")}
    finally{if(action.current===controller)action.current=null;if(!controller.signal.aborted)setBusy(false)}
  }
  const running=job?.state==="running",title=kind==="question"?"A question for your Dial":kind==="read"?"Ra’s independent read":"What the evidence establishes";
  return <div class="card" style={{marginTop:"16px"}}><div class="hstack" style={{gap:"6px"}}><span class="label">{title}</span><InfoTip label={`About: ${title}`} text={kind==="question"?"Ra asks one timing question. You make your call first.":kind==="read"?"Your year and confidence are withheld from Ra's forecast.":"Plans and elapsed dates alone cannot establish it happened."}/></div>{kind==="read"&&<p class="meta">Your year and confidence are withheld.</p>}
    {sources.length?<details><summary>Choose up to six sources</summary>{sources.map(source=><label class="row" key={source.id} style={{gap:"10px",alignItems:"flex-start"}}><input type="checkbox" checked={selection.includes(source.id)} disabled={busy||loading||running||!selection.includes(source.id)&&selection.length>=6} onChange={event=>{const checked=event.currentTarget.checked;setSelection(previous=>checked?[...previous,source.id]:previous.filter(id=>id!==source.id))}}/><span>{source.text}</span></label>)}</details>:<p class="meta">No checked evidence yet.</p>}
    {loading&&<p class="meta" role="status">Checking saved work…</p>}{job&&<p class="meta" role="status">{running?"Considering the selected evidence…":job.state==="completed"?"Kept with your Dial.":job.state==="cancelled"?"Cancelled. Nothing was added.":DIAL_PROBLEMS[job.problem??""]??"This request could not finish."}</p>}{problem&&<p class="meta" role="alert">{problem}</p>}
    {saved&&problem&&<button class="btn btn-line btn-sm" disabled={busy||loading} onClick={()=>void act("status")}>Check saved request</button>}
    <div class="stack" style={{gap:"8px",marginTop:"12px"}}>{running?<button class="btn btn-line" disabled={busy} onClick={()=>void act("cancel")}>Cancel reading</button>:<><button class="btn btn-line" disabled={busy||loading||!selection.length} onClick={()=>void act("new")}>{kind==="question"?"Ask a timing question":kind==="read"?"Request Ra’s read":"Read the outcome evidence"}</button>{saved&&(job?.state==="failed"||job?.state==="interrupted")&&job.problem!=="stale"&&<button class="btn btn-line btn-sm" disabled={busy||loading} onClick={()=>void act("retry")}>Retry this saved request</button>}<button class="btn btn-line btn-sm" disabled={busy||loading} onClick={()=>void act("refresh")}>Refresh sources</button></>}</div>
  </div>;
}
