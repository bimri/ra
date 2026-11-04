import {useState,useRef,useEffect} from "preact/hooks";
import {checkMarkers,currentIsland} from "@ra/core";
import {mind,useMind} from "../../store/mind";
import {localSession,checkLocalSession} from "../../store/db";
import {BackHeader} from "../../ui/BackHeader";
import {navigate} from "../../ui/nav";
import {Icon} from "../../ui/icons";
import {Tip} from "../../ui/Tooltip";
import {loadMarkerDraft,saveMarkerDraft,clearMarkerDraft} from "../../store/markerDraft";

/** E5: the numbered words belong to the person; first wording stays in the event log. */
function Editor({island}:{island:string}) {
  const {views}=useMind();const current=views.markers[island];
  const [base,setBase]=useState(()=>JSON.stringify(current?.markers??[]));
  const [words,setWords]=useState<string[]>(()=>current?.markers.length?[...current.markers]:["","",""]);
  const [busy,setBusy]=useState(false),[problem,setProblem]=useState("");
  const [loaded,setLoaded]=useState(false);const action=useRef(false);
  useEffect(()=>{let active=true;void loadMarkerDraft(island).then(draft=>{if(!active)return;if(draft){setBase(JSON.stringify(draft.base));setWords(draft.words.length?draft.words:["","",""])}setLoaded(true)}).catch(error=>{if(active)setProblem(error instanceof Error?error.message:"The saved draft could not reopen.")});return()=>{active=false}},[island]);
  const changedElsewhere=JSON.stringify(current?.markers??[])!==base;
  async function keep(){
    if(action.current||!loaded)return;action.current=true;setBusy(true);setProblem("");
    try{
      const session=localSession(),copy=mind();const body=checkMarkers({island,markers:words});
      if(JSON.stringify(copy.current.views.markers[island]?.markers??[])!==base)throw new Error("Your markers changed while you were editing. Review the current words first.");
      if(JSON.stringify(body.markers)!==base)await copy.write("markers.named",body);
      await clearMarkerDraft(island);
      checkLocalSession(session);navigate("/chart/island?island="+encodeURIComponent(island));
    }catch(error){setProblem(error instanceof Error?error.message:"Your markers could not be kept.")}
    finally{action.current=false;setBusy(false)}
  }
  async function speak(){
    if(action.current||!loaded)return;action.current=true;setBusy(true);setProblem("");
    try{const scope=localSession(),copy=mind();await saveMarkerDraft({version:1,island,base:JSON.parse(base) as string[],words});await copy.sync();checkLocalSession(scope);if(copy.current.pending.some(event=>event.kind==="markers.named"))throw new Error("Your marker changes are still waiting to sync. You can keep editing offline.");if(copy.current.views.liveRay&&copy.current.views.rays[copy.current.views.liveRay]?.session!=="markers")throw new Error("Finish the current session before naming markers aloud.");navigate("/ray?session=markers&island="+encodeURIComponent(island))}
    catch(error){setProblem(error instanceof Error?error.message:"The spoken session could not open.")}
    finally{action.current=false;setBusy(false)}
  }
  if(!loaded)return <p class="meta" role="status">{problem||"Opening your encrypted marker draft…"}</p>;
  return <>
    <p class="serif" style={{fontSize:"26px",fontStyle:"italic",lineHeight:1.25,margin:"22px 0 18px"}}>How will you know you’ve reached {island}? Say it in your own terms.</p>
    {words.map((word,index)=><div class="card glass" key={index} style={{display:"flex",gap:"12px",alignItems:"center",marginBottom:"10px",padding:"14px 10px 14px 16px"}}>
      <span class="big" style={{fontSize:"30px",flex:"none",width:"22px",color:index===words.length-1?"var(--sig)":"var(--muted)"}}>{index+1}</span>
      <textarea class="bare" rows={2} maxlength={500} aria-label={`Marker ${index+1}`} value={word} disabled={busy} placeholder="I’ll know when…" onInput={event=>{const text=event.currentTarget.value;setWords(previous=>previous.map((value,i)=>i===index?text:value))}} />
      <Tip text={`Remove marker ${index+1}`}><button type="button" class="x" aria-label={`Remove marker ${index+1}`} disabled={busy||words.length<=1} onClick={()=>setWords(previous=>previous.filter((_,i)=>i!==index))}>×</button></Tip>
    </div>)}
    <div class="hstack" style={{gap:"8px"}}>
      <button type="button" class="btn btn-line btn-sm" disabled={busy||words.length>=12} onClick={()=>setWords(previous=>[...previous,""])}>Add a marker</button>
      <button type="button" class="btn btn-line btn-sm" disabled={busy||changedElsewhere} onClick={()=>void speak()}><Icon name="mic" size={16} /> Name them aloud</button>
    </div>
    <p class="meta" style={{margin:"14px 0 0"}}>{current?`Named ${new Date(current.namedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}. `:""}First wording is kept.</p>
    {current&&JSON.stringify(current.first)!==JSON.stringify(current.markers)&&<details class="card-line" style={{marginTop:"12px"}}><summary class="label" style={{cursor:"pointer"}}>First wording</summary><ol class="meta" style={{margin:"10px 0 0",paddingLeft:"18px"}}>{current.first.map((word,index)=><li key={index}>{word}</li>)}</ol></details>}
    {changedElsewhere&&<div class="card" role="alert"><p>Your markers changed while you were editing. Your unsaved words are still above.</p><ol>{current?.markers.map((word,index)=><li key={index}>{word}</li>)}</ol><button type="button" class="btn btn-line" onClick={()=>{setWords(current?.markers.length?[...current.markers]:["","",""]);setBase(JSON.stringify(current?.markers??[]));setProblem("")}}>Replace this draft with current words</button></div>}
    {problem&&<p class="meta" role="alert">{problem}</p>}
    <div style={{flex:1,minHeight:"22px"}} />
    <button type="button" class="btn btn-accent" style={{width:"100%",marginBottom:"30px"}} disabled={busy||changedElsewhere} onClick={()=>void keep()}>{busy?"Keeping…":"Keep markers"}</button>
  </>;
}
export function MarkersScreen(){
  const {views}=useMind();const island=new URLSearchParams(location.search).get("island")??currentIsland(views);
  const known=island&&(Object.hasOwn(views.markers,island)||Object.hasOwn(views.islands,island));
  return <div class="ui"><div class="pg" style={{position:"absolute",inset:0,padding:"22px 20px 0",display:"flex",flexDirection:"column",overflowY:"auto"}}>
    <BackHeader to={known?"/chart/island?island="+encodeURIComponent(island):"/chart"} title="Markers" purpose="How you’ll know you’ve arrived, in your own words." />
    {known?<Editor key={island} island={island}/>:<p class="meta" style={{marginTop:"24px"}}>No island selected.</p>}
  </div></div>;
}
