import { useState,useRef } from "preact/hooks";
import {currentIsland,type DialCallView} from "@ra/core";
import { mind, useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { DialArt } from "../../ui/art/DialArt";
import { Icon } from "../../ui/icons";
import { go } from "../../ui/nav";
import {DialEvidencePanel} from "./DialEvidencePanel";
import {localSession,checkLocalSession} from "../../store/db";
import {DialWorkPanel,DialBasisView} from "./DialWorkPanel";
import { Tip, GLOSSARY } from "../../ui/Tooltip";

// E6 / E7 · the Dial. Ra asks when something on your horizon will happen;
// you make your call first, and only then see Ra's read. "We look again"
// on the date you both agreed (E8 comes back to it).

const SURE = [0.5, 0.6, 0.75, 0.9];
const pct = (n: number) => `${Math.round(n * 100)}%`;

function YourCall({ call }: { call: DialCallView }) {
  const start = new Date().getFullYear();
  const [year, setYear] = useState(start + 2);
  const [sure, setSure] = useState(0.6);
  const [busy,setBusy]=useState(false),[problem,setProblem]=useState("");
  const saving=useRef(false);
  async function keep(){if(saving.current)return;saving.current=true;setBusy(true);setProblem("");try{const scope=localSession();await mind().write("dial.call",{callId:call.callId,claim:String(year),confidence:sure,reviewAt:call.reviewAt});checkLocalSession(scope)}catch(error){setProblem(error instanceof Error?error.message:"Your call could not be kept.")}finally{saving.current=false;setBusy(false)}}
  const step = (d: number) => setYear((y) => Math.min(start + 6, Math.max(start, y + d)));
  return (
    <>
      <div class="h1" style={{ marginTop: "16px", fontSize: "30px" }}>
        {call.question}
      </div>
      {/* E6: the board's gauge; the needle follows your call. */}
      <div style={{ margin: "14px 0 0", flex: "none" }}>
        <DialArt start={start} call={year} />
      </div>
      <div class="spread" style={{ marginTop: "8px" }}>
        <span class="hstack" style={{ gap: "6px" }}>
          <Tip text="A year earlier"><button type="button" class="key" aria-label="A year earlier" style={{ width: "36px", height: "36px" }} onClick={() => step(-1)} disabled={year === start}>
            <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
              <Icon name="arrow" size={16} />
            </span>
          </button></Tip>
          <span class="big" style={{ fontSize: "44px" }}>
            {year}
          </span>
          <Tip text="A year later"><button type="button" class="key" aria-label="A year later" style={{ width: "36px", height: "36px" }} onClick={() => step(1)} disabled={year === start + 6}>
            <Icon name="arrow" size={16} />
          </button></Tip>
        </span>
        <span class="label">Your call</span>
      </div>
      <div class="label" style={{ marginTop: "18px" }}>
        How sure are you?
      </div>
      <div class="seg" style={{ marginTop: "10px" }} role="radiogroup" aria-label="How sure are you?">
        {SURE.map((s) => (
          <span key={s} role="radio" aria-checked={s === sure} tabIndex={0} class={s === sure ? "on" : ""} onClick={() => setSure(s)}>
            {pct(s)}
          </span>
        ))}
      </div>
      <p class="meta" style={{ margin: "14px 0 0" }}>
        Ra's read stays hidden until you lock in. Look again on {new Date(call.reviewAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}.
      </p>
      <div style={{ flex: 1, minHeight: "20px" }} />
      <div style={{ paddingBottom: "30px" }}>
        <button
          type="button"
          class="btn btn-accent"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={() => void keep()}
        >
          <Icon name="dial" size={18} /> Lock in {year} · {pct(sure)}
        </button>
        {problem&&<p class="meta" role="alert">{problem}</p>}
      </div>
    </>
  );
}

function RasRead({ call }: { call: DialCallView }) {
  const read = call.reads.findLast(read=>read.basis?read.basis.forReviewAt===call.reviewAt:call.reviews.length===0);
  const year = Number(call.claim);
  const range: [number, number] | null = read && read.from !== null && read.to !== null ? [read.from, read.to] : null;
  const start = Math.min(Number.isFinite(year) ? year : Infinity, range?.[0] ?? Infinity, new Date(call.reviewAt).getFullYear()) - 1;
  const dialStart = Number.isFinite(start) ? start : new Date().getFullYear();
  const lookAgain = new Date(call.reviewAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <>
      <div class="h1" style={{ marginTop: "16px", fontSize: "30px" }}>
        {call.question ?? "Your call"}
      </div>
      <div style={{ margin: "14px 0 0", flex: "none" }}>
        <DialArt start={dialStart} call={Number.isFinite(year) ? year : null} range={range} />
      </div>
      <div class="grid3 hair" style={{ gridTemplateColumns: "1fr 1fr", marginTop: "16px" }}>
        <div>
          <div class="label">Your call · first</div>
          <div class="big" style={{ fontSize: "34px", marginTop: "6px" }}>
            {call.claim}
          </div>
          {call.confidence !== null && <div class="meta">{pct(call.confidence)} sure</div>}
        </div>
        <div>
          <div class="label" style={{ color: "var(--sig)" }}>
            Ra’s read{range ? ` · ${range[1] - range[0] >= 3 ? "wide" : "narrow"}` : ""}
          </div>
          <div class="big" style={{ fontSize: "34px", marginTop: "6px" }}>
            {range ? `${String(range[0]).slice(2)}–${String(range[1]).slice(2)}` : "…"}
          </div>
          <div class="meta">{range ? `${range[0]} to ${range[1]}` : read?"No supported year range":"Not read yet"}</div>
        </div>
      </div>
      {read && (
        <div class="hair" style={{ marginTop: "18px", paddingTop: "16px" }}>
          <div class="hstack" style={{ gap: "10px", alignItems: "flex-start" }}>
            <span style={{ flex: "none", width: "7px", height: "7px", marginTop: "8px", borderRadius: "50%", background: "var(--sig)", boxShadow: "0 0 10px var(--sig)" }} />
            <p class="serif" style={{ margin: 0, fontSize: "20px", lineHeight: 1.25, fontStyle: "italic" }}>
              {read.text}
            </p>
          </div>
          {read.basis&&<DialBasisView basis={read.basis}/>}
        </div>
      )}
      <DialEvidencePanel key={call.callId+":"+call.reviewAt} call={call}/>
      {!read&&<DialWorkPanel key={"read:"+call.callId+":"+call.reviewAt} kind="read" call={call}/>}
      {call.outcomes.length>0&&<details class="card" style={{marginTop:"12px"}}><summary>Recorded outcomes</summary>{call.outcomes.map(outcome=><div class="hair" key={outcome.basis.operationId} style={{marginTop:"10px",paddingTop:"10px"}}><span class="label">{new Date(outcome.at).toLocaleDateString("en-GB")} · {outcome.status==="observed"?"Observed":outcome.status==="not-yet"?"Not yet observed":"Unclear"}</span><p>{outcome.text}</p><DialBasisView basis={outcome.basis}/></div>)}</details>}
      {call.reviews.length>0&&<details class="card" style={{marginTop:"12px"}}><summary>Review history</summary>{call.reviews.map((review,index)=><div class="hair" key={index} style={{paddingTop:"10px",marginTop:"10px"}}><span class="label">{new Date(review.at).toLocaleDateString("en-GB")}</span><p>{review.claim} · {pct(review.confidence)} sure</p>{review.superseded&&<p class="meta">Superseded. Current call preserved.</p>}</div>)}</details>}
      <div style={{ flex: 1, minHeight: "20px" }} />
      {call.reviewAt <= Date.now() ? (
        <div style={{ paddingBottom: "30px" }}>
          <a href={`/chart/dial/review?id=${call.callId}`} onClick={go(`/chart/dial/review?id=${call.callId}`)} class="btn btn-accent" style={{ width: "100%" }}>
            <Icon name="dial" size={18} /> Look again now
          </a>
        </div>
      ) : (
        <div class="spread" style={{ paddingBottom: "30px" }}>
          <span class="label">Look again · {lookAgain}</span>
          <span class="pill">
            <span class="d" />
            Reminder set
          </span>
        </div>
      )}
    </>
  );
}

export function DialScreen() {
  const { views } = useMind();
  const calls = Object.values(views.dial);
  const open = calls.filter((c) => c.claim !== "" && c.reviewAt > Date.now());
  const requested=new URLSearchParams(location.search).get("id");const selected=requested?calls.find(call=>call.callId===requested):undefined;
  const waiting = selected?(selected.claim===""?selected:undefined):calls.find((c) => c.claim === "");
  const shown = selected??waiting ?? calls.filter((c) => c.claim !== "").at(-1);

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div class="spread">
          <BackHeader to="/chart" title={waiting ? "Dial · your call" : "Dial"} purpose="When things on your horizon will happen. Your call first, then Ra’s read." />
          {!waiting && open.length > 0 && (
            <span class="label">
              {open.length} open {open.length === 1 ? "call" : "calls"}
            </span>
          )}
        </div>
        {!shown ? (
          <>
            <div class="h1" style={{ marginTop: "16px", fontSize: "30px" }}>
              No calls yet.
            </div>
            <p class="meta" style={{ margin: "12px 0 0" }}>
              Ra asks when timing is uncertain. You call first.
            </p>
          </>
        ) : waiting ? (
          <YourCall key={waiting.callId} call={waiting} />
        ) : (
          <RasRead call={shown} />
        )}
        {!waiting&&views.star.current&&currentIsland(views)&&<DialWorkPanel key="question" kind="question"/>}
      </div>
    </div>
  );
}
