import {useEffect,useRef,useState} from "preact/hooks";
import type {MindMessage} from "@ra/core";
import {addMarkerWord,loadMarkerDraft,saveMarkerDraft,type MarkerDraft} from "../../store/markerDraft";
import {localSession,checkLocalSession} from "../../store/db";
import {navigate} from "../../ui/nav";
export function SpokenMarkers({snapshot,onEnd}:{snapshot:Extract<MindMessage,{t:"markers"}>;onEnd:()=>void}){
  const [draft,setDraft]=useState<MarkerDraft|null>(null),[problem,setProblem]=useState("");
  const [busy,setBusy]=useState(false);const action=useRef(false),active=useRef(true);
  useEffect(()=>{active.current=true;void loadMarkerDraft(snapshot.island).then(value=>{if(active.current)setDraft(value??{version:1,island:snapshot.island,base:[...snapshot.base],words:[...snapshot.base]})}).catch(error=>{if(active.current)setProblem(error instanceof Error?error.message:"The marker draft could not reopen.")});return()=>{active.current=false}},[snapshot.island]);
  async function act(text?:string){
    if(!draft||action.current)return;action.current=true;setBusy(true);setProblem("");
    try{const scope=localSession(),next=text===undefined?draft:addMarkerWord(draft,text);await saveMarkerDraft(next);checkLocalSession(scope);if(!active.current)return;setDraft(next);if(text===undefined){onEnd();navigate("/chart/markers?island="+encodeURIComponent(snapshot.island))}}
    catch(error){if(active.current)setProblem(error instanceof Error?error.message:"The marker draft could not be saved.")}
    finally{action.current=false;if(active.current)setBusy(false)}
  }
  return <div class="card glass" style={{marginTop:"14px",maxHeight:"34vh",overflowY:"auto"}}>
    <div class="label">Markers · {snapshot.island}</div>
    <p class="meta">Talking does not save a marker. Review first.</p>
    {draft&&<p class="meta">{draft.words.filter(word=>word.trim()).length} in your encrypted draft.</p>}
    {draft&&JSON.stringify(draft.base)!==JSON.stringify(snapshot.base)&&<p class="meta" role="alert">Your saved draft uses earlier markers. Review it against the current words before keeping.</p>}
    {snapshot.statements.map(statement=><div class="hair" style={{paddingTop:"10px",marginTop:"10px"}} key={statement.id}><p style={{whiteSpace:"pre-wrap"}}>{statement.text}</p><button class="btn btn-line btn-sm" disabled={busy||!draft||statement.text.length>500} onClick={()=>void act(statement.text)}>Use this wording</button>{statement.text.length>500&&<p class="meta">This statement is too long for one marker. Write shorter wording in the editor; it has not been cut.</p>}</div>)}
    {snapshot.omitted>0&&<p class="meta">{snapshot.omitted} statements not shown. Transcripts stay in your Mind.</p>}
    {!snapshot.statements.length&&<p class="meta">Nothing yet.</p>}
    {problem&&<p class="meta" role="alert">{problem}</p>}
    <button class="btn btn-accent" disabled={busy||!draft} onClick={()=>void act()}>End and review markers</button>
  </div>;
}
