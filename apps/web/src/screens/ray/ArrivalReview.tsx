import type { Views, PhoneMessage, StageName } from "@ra/core";
import { useState } from "preact/hooks";
import { api } from "../../store/device";
import { mind } from "../../store/mind";
import { navigate } from "../../ui/nav";

export function ArrivalReview({ arrival,stage,rayId,live,unresolved,crew,send,onDone }: {
  arrival: Views["arrivals"][number]; stage: StageName; rayId: string | null; live: boolean; unresolved: boolean;
  crew: Views["crew"]; send(message:PhoneMessage):void; onDone():void;
}) {
  const [said,setSaid] = useState(arrival.said);
  const [witnesses,setWitnesses] = useState(arrival.witnesses.map((w) => w.introId));
  const [busy,setBusy] = useState(false);
  const [problem,setProblem] = useState("");
  async function confirm() {
    setBusy(true); setProblem("");
    try {
      const response = await fetch(api("/landfall/confirm"),{ method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({ landfallId:arrival.landfallId,rayId,said,witnesses }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The landfall could not be recorded.");
      await mind().sync(); onDone(); navigate("/landfall");
    } catch (error) { setProblem(error instanceof Error ? error.message : "The landfall could not be recorded."); }
    finally { setBusy(false); }
  }
  return <div class="card" style={{ marginTop:"16px",maxHeight:"40vh",overflowY:"auto" }}>
    <div class="label">Landfall · {arrival.island}</div>
    {arrival.markers.map((marker) => <div key={marker.markerId} class="row" style={{ flexDirection:"column",alignItems:"stretch",gap:"4px" }}><span class="title">{marker.text}</span><span class="meta">{marker.evidence}</span></div>)}
        <button class="btn btn-line btn-sm" disabled={!live || busy} onClick={() => send({ t:"landfall.review",resolved:unresolved })}>{unresolved ? "I've looked again" : "Something doesn't match yet"}</button>
    {unresolved && <p class="meta" role="status">Stay with what does not match. Arrival can wait.</p>}
    {stage === "arrival-witness" && <div>
      <p class="meta">Witnesses optional.</p>
      {crew.map((c) => <label class="row" key={c.introId}><span class="grow">{c.name}</span><input type="checkbox" checked={witnesses.includes(c.introId)} onChange={(e) => setWitnesses((old) => e.currentTarget.checked ? [...old,c.introId] : old.filter((id) => id !== c.introId))} /></label>)}
    </div>}
    {stage === "arrival-confirm" ? <>
      <label class="label" for="arrival-words">In your words: what is it like now?</label>
      <textarea class="field" id="arrival-words" rows={2} maxlength={2000} value={said} onInput={(e) => setSaid(e.currentTarget.value)} />
      <button class="btn btn-ink" disabled={!live || busy || unresolved || !said.trim()} onClick={() => void confirm()}>{busy ? "Recording…" : "I've arrived · add it to my rings"}</button>
    </> : <button class="btn btn-ink btn-sm" style={{ marginTop:"12px" }} disabled={!live || busy || unresolved} onClick={() => send({ t:"landfall.next" })}>{stage === "arrival-witness" ? "Review my arrival" : "Continue to witnesses"}</button>}
    {problem && <p class="meta" role="alert">{problem}</p>}
  </div>;
}
