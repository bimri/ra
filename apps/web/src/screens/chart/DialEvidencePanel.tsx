import {useEffect,useRef,useState} from "preact/hooks";
import {verifiedHorizon,type DialCallView} from "@ra/core";
import {useHorizon,refreshHorizon} from "../../store/horizon";
import {mind} from "../../store/mind";
import {api} from "../../store/device";
import {localSession,checkLocalSession} from "../../store/db";
function cited(url:string){try{const parsed=new URL(url);return ["https:","http:"].includes(parsed.protocol)&&!parsed.username&&!parsed.password}catch{return false}}
/** Exact source checkpoints; no generated forecast, implied outcome or automatic POST on reconnect. */
export function DialEvidencePanel({call}:{call:DialCallView}){
  const shared=useHorizon();const [horizon,setHorizon]=useState(shared);useEffect(()=>setHorizon(shared),[shared]);const [selection,setSelection]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const action=useRef<AbortController|null>(null);useEffect(()=>()=>action.current?.abort(),[]);
  const available=(horizon?.signals??[]).filter(signal=>verifiedHorizon(signal,Date.now())&&signal.sources.some(cited)&&typeof signal.at==="number"&&signal.at<=Date.now()&&signal.at>=Date.now()-30*86_400_000);
  const latest=call.observations.findLast(snapshot=>snapshot.forReviewAt===call.reviewAt);
  async function check(){
    if(action.current)return;const controller=new AbortController();action.current=controller;setBusy(true);setMessage("");
    try{
      const scope=localSession(),copy=mind();await copy.sync();checkLocalSession(scope);controller.signal.throwIfAborted();
      if(copy.current.pending.some(event=>(event.kind==="dial.call"||event.kind==="dial.reviewed")&&"callId" in event.body&&event.body.callId===call.callId))throw new Error("Your call is still waiting to sync. Send it before checking the evidence.");
      const response=await fetch(api("/dial/evidence"),{method:"POST",credentials:"include",cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]),headers:{"content-type":"application/json","x-ra-account":scope.owner},body:JSON.stringify({callId:call.callId,signalIds:selection})});
      checkLocalSession(scope);controller.signal.throwIfAborted();const value=await response.json();checkLocalSession(scope);controller.signal.throwIfAborted();
      if(!response.ok||!value.ok)throw new Error(value.error??"The source check could not complete.");
      if(value.snapshot?.version!==1)throw new Error("This source result needs a newer app version.");
      await copy.sync();checkLocalSession(scope);controller.signal.throwIfAborted();setMessage(value.unchanged?"This exact evidence is already kept with this review.":"Evidence kept. Your call and Ra’s previous read are unchanged.");
    }catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"The source check could not complete.")}
    finally{if(action.current===controller)action.current=null;if(!controller.signal.aborted)setBusy(false)}
  }
  async function refresh(){
    if(action.current)return;const controller=new AbortController();action.current=controller;setBusy(true);setMessage("");
    try{const scope=localSession(),value=await refreshHorizon();checkLocalSession(scope);controller.signal.throwIfAborted();if(!value)throw new Error("Sources could not refresh. Your call is unchanged.");setHorizon(value);setSelection([])}
    catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"Sources could not refresh. Your call is unchanged.")}
    finally{if(action.current===controller)action.current=null;if(!controller.signal.aborted)setBusy(false)}
  }
  return <div class="card" style={{marginTop:"16px"}}>
    <div class="label">Evidence for looking again</div>
    {latest?<>
      <p class="meta">Kept {new Date(latest.checkedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})} · source words only. No forecast.</p>
      {latest.items.map(source=><div key={source.id} class="hair" style={{paddingTop:"10px",marginTop:"10px"}}><p style={{margin:"0 0 8px"}}>{source.text}</p>{source.timing&&<p class="meta">Source timing: {source.timing}</p>}{source.direction&&<p class="meta">Source direction: {source.direction}</p>}<span class="label">Read {new Date(source.at).toLocaleDateString("en-GB")}</span>{source.sources.map(url=><a class="row" key={url} href={url} target="_blank" rel="noopener noreferrer" style={{fontSize:"13px",overflowWrap:"anywhere"}}>{url}</a>)}</div>)}
    </>:<p class="meta">No evidence kept yet.</p>}
    {available.length?<details style={{marginTop:"12px"}}><summary>Choose related Horizon evidence</summary><p class="meta">Up to six. Source words and dates only.</p>{available.map(source=><label key={source.id} class="row" style={{gap:"10px",alignItems:"flex-start"}}><input type="checkbox" checked={selection.includes(source.id)} disabled={busy||!selection.includes(source.id)&&selection.length>=6} onChange={event=>{const checked=event.currentTarget.checked;setSelection(previous=>checked?[...previous,source.id]:previous.filter(id=>id!==source.id))}}/><span>{source.text}</span></label>)}<button class="btn btn-line" disabled={busy||!selection.length||!call.claim.trim()} onClick={()=>void check()}>{busy?"Checking…":"Keep selected evidence"}</button></details>:<p class="meta">No checked evidence available.</p>}
    {message&&<p class="meta" role="status">{message}</p>}
    <button class="btn btn-line btn-sm" disabled={busy} onClick={()=>void refresh()}>Refresh sources</button>
  </div>;
}
