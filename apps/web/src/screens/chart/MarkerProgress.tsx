import { useEffect, useState, useRef } from "preact/hooks";
import {markerRef} from "@ra/core";
import { api } from "../../store/device";
import { mind, useMind } from "../../store/mind";
import {localSession,checkLocalSession} from "../../store/db";

export function MarkerProgress({ island }: { island: string }) {
  const { views } = useMind();
  const wording = JSON.stringify(views.markers[island]?.markers ?? []);
  const [markers,setMarkers] = useState<{ markerId:string; text:string }[]>([]);
  const [evidence,setEvidence] = useState<Record<string,string>>({});
  const [busy,setBusy] = useState<string | null>(null);
  // E4: markers are rows with a circle; the one you open asks how you know.
  const [open,setOpen] = useState<string | null>(null);
  const [problem,setProblem] = useState("");
  const action=useRef<AbortController|null>(null);
  useEffect(()=>()=>action.current?.abort(),[]);
  useEffect(() => {
    const controller = new AbortController();
    setMarkers([]); setProblem("");
    void Promise.all((JSON.parse(wording) as string[]).map(async text=>({markerId:await markerRef(island,text),text}))).then(result=>{
      if(!controller.signal.aborted)setMarkers(result);
    }).catch(()=>{if(!controller.signal.aborted)setProblem("Your local markers could not load.")});
    return () => controller.abort();
  },[island,wording]);
  async function reach(markerId:string) {
    if(action.current)return;
    const controller=new AbortController();action.current=controller;
    setBusy(markerId); setProblem("");
    try {
      const session=localSession(),copy=mind();
      const response = await fetch(api("/markers/reach"),{ method:"POST",credentials:"include",signal:controller.signal,headers:{"content-type":"application/json"},body:JSON.stringify({ island,markerId,evidence:evidence[markerId] ?? "" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "That marker was not recorded.");
      checkLocalSession(session);await copy.sync();setOpen(null);
    } catch (error) { if(!controller.signal.aborted)setProblem(error instanceof Error ? error.message : "That marker was not recorded."); }
    finally { if(action.current===controller)action.current=null;if(!controller.signal.aborted)setBusy(null); }
  }
  return <div>
    {!markers.length && !problem && <p class="meta" role="status">Loading your markers…</p>}
    {markers.map((marker) => {
      const reached = views.markerAchievements.find((a) => a.island === island && a.markerId === marker.markerId);
      const shown = !reached && open === marker.markerId;
      return <div key={marker.markerId} class="hair">
        <button type="button" aria-expanded={reached ? undefined : shown} disabled={!!reached} onClick={() => setOpen(shown ? null : marker.markerId)} style={{ display:"flex",alignItems:"center",gap:"12px",width:"100%",padding:"11px 0",border:"none",background:"none",font:"inherit",color:"inherit",textAlign:"left",cursor:reached ? "default" : "pointer" }}>
          <span aria-hidden="true" style={{ flex:"none",width:"22px",height:"22px",borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",background:reached ? "var(--sig)" : "transparent",boxShadow:reached ? "none" : "inset 0 0 0 1.4px var(--line)",color:"var(--on-accent)",fontSize:"12px" }}>{reached ? "✓" : ""}</span>
          <span style={{ fontSize:"15px",lineHeight:1.3 }}>{marker.text}</span>
        </button>
        {reached && <p class="meta" style={{ margin:"0 0 10px 34px" }}>{reached.evidence}</p>}
        {shown && <div class="stack" style={{ gap:"8px",margin:"0 0 12px 34px" }}>
          <textarea class="field" rows={2} maxlength={2000} aria-label={"How you know: "+marker.text} placeholder="How do you know you reached it?" value={evidence[marker.markerId] ?? ""} onInput={(e) => setEvidence((old) => ({ ...old,[marker.markerId]:e.currentTarget.value }))} />
          <button class="btn btn-ink btn-sm" style={{ alignSelf:"flex-start" }} disabled={busy !== null || !evidence[marker.markerId]?.trim()} onClick={() => void reach(marker.markerId)}>{busy === marker.markerId ? "Recording…" : "I reached it"}</button>
        </div>}
      </div>;
    })}
    {problem && <p class="meta" role="alert">{problem}</p>}
  </div>;
}
