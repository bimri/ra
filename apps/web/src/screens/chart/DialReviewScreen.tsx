import { useState,useRef,useEffect } from "preact/hooks";
import { mind, useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { Icon } from "../../ui/icons";
import { navigate } from "../../ui/nav";
import {DialEvidencePanel} from "./DialEvidencePanel";
import {localSession,checkLocalSession} from "../../store/db";
import {DialWorkPanel,DialBasisView} from "./DialWorkPanel";
import { Tip } from "../../ui/Tooltip";

// E8 · Dial · looking again. The date you agreed on has come: what you
// called, what Ra read, what happened since, and your call now. You make it
// again before anything else; "we look again" in another six months.

const SURE = [0.5, 0.6, 0.7, 0.8, 0.9];
const HALF_YEAR = 182 * 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function DialReviewScreen() {
  const { views } = useMind();
  const id = new URLSearchParams(location.search).get("id");
  const calls = Object.values(views.dial).filter((c) => c.claim !== "");
  const call = calls.find((c) => c.callId === id) ?? calls.filter((c) => c.reviewAt <= Date.now()).sort((a, b) => a.reviewAt - b.reviewAt)[0];
  const [year, setYear] = useState(() => Number(call?.claim) || new Date().getFullYear() + 2);
  const [sure, setSure] = useState(call?.confidence ?? 0.6);
  const [kept, setKept] = useState(false);
  const [busy,setBusy]=useState(false),[problem,setProblem]=useState("");
  const saving=useRef(false);const [base,setBase]=useState(()=>call?{callId:call.callId,reviewAt:call.reviewAt}:null);
  useEffect(()=>{if(call&&!base){setYear(Number(call.claim)||new Date().getFullYear()+2);setSure(call.confidence??.6);setBase({callId:call.callId,reviewAt:call.reviewAt})}},[call?.callId,base]);

  if (!call) {
    return (
      <div class="ui">
        <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
          <BackHeader to="/chart/dial" title="Looking again" purpose="Your call came due. Say what happened, and whether you’d call it the same." />
          <p class="meta" style={{ margin: "18px 0 0" }}>
            No call is due to look at again.
          </p>
        </div>
      </div>
    );
  }

  const read = call.reads.findLast(read=>read.basis?read.basis.forReviewAt===call.reviewAt:call.reviews.length===0);
  const range = read && read.from !== null && read.to !== null ? `${read.from}–${String(read.to).slice(2)}` : null;
  const first = call.first ?? { claim: call.claim, confidence: call.confidence };
  const outcome=call.outcomes.findLast(outcome=>outcome.basis.forReviewAt===call.reviewAt);
  const happened = outcome?.text??null;
  const sources = outcome?new Set(outcome.basis.sources.flatMap(source=>source.sources)).size:0;
  const next = new Date(Date.now() + HALF_YEAR);
  const lookedAgain = calls.filter((c) => c.reviews.length > 0).length;
  const stale=!base||base.callId!==call.callId||base.reviewAt!==call.reviewAt;

  async function keep() {
    if(saving.current||kept||stale)return;saving.current=true;setBusy(true);setProblem("");
    try{const scope=localSession(),observation=call!.observations.findLast(snapshot=>snapshot.forReviewAt===base!.reviewAt);await mind().write("dial.reviewed", { callId: call!.callId, claim: String(year), confidence: sure, nextReviewAt: Date.now() + HALF_YEAR,previousReviewAt:base!.reviewAt,...(observation?{observationId:observation.snapshotId}:{}) });checkLocalSession(scope);setKept(true);navigate("/chart/dial?id="+encodeURIComponent(call!.callId))}
    catch(error){setProblem(error instanceof Error?error.message:"Your revised call could not be kept.")}
    finally{saving.current=false;setBusy(false)}
  }

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div class="spread">
          <BackHeader to="/chart/dial" title="Looking again" purpose="Your call came due. Say what happened, and whether you’d call it the same." />
          <span class="label">{new Date(call.reviewAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
        </div>
        <div class="h1" style={{ marginTop: "16px", fontSize: "28px" }}>
          {call.question ?? "Your call"}
        </div>
        <div class="grid3 hair" style={{ gridTemplateColumns: "1fr 1fr", marginTop: "18px" }}>
          <div>
            <div class="label">You called</div>
            <div class="title" style={{ fontSize: "20px", marginTop: "4px" }}>
              {first.claim}
              {first.confidence !== null ? ` · ${pct(first.confidence)}` : ""}
            </div>
          </div>
          <div>
            <div class="label">Ra read</div>
            <div class="title" style={{ fontSize: "20px", marginTop: "4px" }}>
              {range ?? "Not read"}
            </div>
          </div>
        </div>
        <div class="card" style={{ marginTop: "16px" }}>
          <div class="spread">
            <span class="label">What happened</span>
            {sources > 0 && <span class="label">recorded note · {sources} sources</span>}
          </div>
          <div class="title" style={{ fontSize: "16px", marginTop: "8px", color: happened ? undefined : "var(--muted)" }}>
            {happened ?? "Ra hasn't read what happened yet. Make your call on what you've seen."}
          </div>
          {outcome&&<><p class="meta">{outcome.status==="observed"?"Observed in these sources":outcome.status==="not-yet"?"The sources explicitly report that it has not happened":"The outcome remains unclear"}</p><DialBasisView basis={outcome.basis}/></>}
        </div>
        {!outcome&&call.reviewAt<=Date.now()&&<DialWorkPanel key={"outcome:"+call.callId+":"+call.reviewAt} kind="outcome" call={call}/>}
        <DialEvidencePanel key={call.callId+":"+call.reviewAt} call={call}/>
        <div class="spread" style={{ marginTop: "18px", alignItems: "flex-end" }}>
          <div>
            <div class="label">Your call now</div>
            <div class="hstack" style={{ gap: "6px", marginTop: "6px" }}>
              <Tip text="A year earlier"><button type="button" class="key" aria-label="A year earlier" style={{ width: "34px", height: "34px" }} onClick={() => setYear((y) => y - 1)}>
                <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
                  <Icon name="arrow" size={14} />
                </span>
              </button></Tip>
              <span class="big" style={{ fontSize: "48px" }}>
                {year}
              </span>
              <Tip text="A year later"><button type="button" class="key" aria-label="A year later" style={{ width: "34px", height: "34px" }} onClick={() => setYear((y) => y + 1)}>
                <Icon name="arrow" size={14} />
              </button></Tip>
            </div>
          </div>
          <span class="big accent" style={{ fontSize: "48px" }}>
            {pct(sure)}
          </span>
        </div>
        <div class="meter" style={{ marginTop: "12px", height: "10px", borderRadius: "5px" }}>
          <i class="dither" style={{ width: pct(sure), borderRadius: "5px" }} />
        </div>
        <div class="seg" style={{ marginTop: "10px" }} role="radiogroup" aria-label="How sure are you now?">
          {SURE.map((s) => (
            <span key={s} role="radio" aria-checked={s === sure} tabIndex={0} class={s === sure ? "on" : ""} onClick={() => setSure(s)}>
              {pct(s)}
            </span>
          ))}
        </div>
        <div class="hair" style={{ marginTop: "16px", paddingTop: "14px" }}>
          <div class="spread">
            <span class="label">Your calls so far</span>
            <div class="hstack" style={{ gap: "5px" }}>
              {calls.map((c) => (
                <span
                  key={c.callId}
                  style={
                    c.reviews.length
                      ? { width: "12px", height: "12px", borderRadius: "50%", background: "var(--sig)", boxShadow: "0 0 6px var(--sig)" }
                      : { width: "12px", height: "12px", borderRadius: "50%", boxShadow: "inset 0 0 0 1.5px var(--faint)" }
                  }
                />
              ))}
            </div>
          </div>
          <p class="meta" style={{ margin: "8px 0 0" }}>
            You've looked again at {lookedAgain} of {calls.length} {calls.length === 1 ? "call" : "calls"}. We look again in {MONTHS[next.getMonth()]}.
          </p>
        </div>
        <div style={{ flex: 1, minHeight: "18px" }} />
        <div style={{ paddingBottom: "30px" }}>
          {stale&&<div class="card" role="alert"><p>This call changed while the review was open. Your unsaved revision is still above.</p><button class="btn btn-line" onClick={()=>{setYear(Number(call.claim)||new Date().getFullYear()+2);setSure(call.confidence??.6);setBase({callId:call.callId,reviewAt:call.reviewAt})}}>Use the current call</button></div>}
          {problem&&<p class="meta" role="alert">{problem}</p>}
          <button type="button" class="btn btn-accent" style={{ width: "100%" }} onClick={()=>void keep()} disabled={kept||busy||stale}>
            <Icon name="dial" size={18} /> {kept ? "Kept" : `Keep ${year} · ${pct(sure)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
