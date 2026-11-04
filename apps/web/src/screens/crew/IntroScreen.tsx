import type { CrewKind } from "@ra/core";
import { useState } from "preact/hooks";
import { api } from "../../store/device";
import { mind, useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { navigate } from "../../ui/nav";
import { Avatar, KIND_LABEL } from "./CrewScreen";

// H2 · An introduction. Two yeses, or nothing. You see their beacon, in
// their words; they see yours only if you say yes too. Ra never pushes an
// introduction you hesitate over: "Not now" ends it, quietly.

const ASK: Record<CrewKind, string> = {
  "same-star": "Someone is steering by the same star. Would you like to meet?",
  "neighbouring-star": "Someone is steering by a neighbouring star. Would you like to meet?",
  ahead: "Someone a few islands ahead is steering your way. Would you like to meet?",
  behind: "Someone a few islands behind you is on the same course. Would you like to meet?",
};

async function post(path: string, body: unknown): Promise<boolean> {
  const res = await fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "include" }).catch(() => null);
  return !!res?.ok;
}

export function IntroScreen() {
  const { views } = useMind();
  const id = new URLSearchParams(location.search).get("id");
  const intro = views.intros.find((i) => i.introId === id) ?? views.intros.filter((i) => i.answer === null).at(-1);
  const [busy, setBusy] = useState(false);
  const [safety, setSafety] = useState(false);

  if (!intro) {
    return (
      <div class="ui">
        <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
          <BackHeader to="/crews" title="An introduction" purpose="Someone Ra thinks you should meet. Say yes, or not now." />
          <p class="meta" style={{ margin: "18px 0 0" }}>
            No introduction is waiting.
          </p>
        </div>
      </div>
    );
  }

  async function answer(yes: boolean) {
    setBusy(true);
    await post("/people/intro", { introId: intro!.introId, yes });
    await mind().sync();
    navigate("/crews");
  }

  async function block(report: boolean) {
    setBusy(true);
    await post("/people/block", { introId: intro!.introId, report });
    await mind().sync();
    navigate("/crews");
  }

  const [lead, ...rest] = intro.beacon.split(/(?<=[.!?])\s+/);
  const when = new Date(intro.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const answered = intro.answer !== null;

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
          <span class="label">An introduction · {when}</span>
        </header>
        <div style={{ marginTop: "20px" }}>
          <div class="hstack" style={{ gap: "10px", alignItems: "flex-start" }}>
            <span style={{ flex: "none", width: "7px", height: "7px", marginTop: "10px", borderRadius: "50%", background: "var(--sig)", boxShadow: "0 0 10px var(--sig)" }} />
            <p class="serif" style={{ margin: 0, fontSize: "24px", lineHeight: 1.25, fontStyle: "italic" }}>
              {ASK[intro.kind]}
            </p>
          </div>
        </div>
        <div class="card" style={{ marginTop: "20px" }}>
          <div class="hstack" style={{ gap: "12px" }}>
            <Avatar name={intro.name} size={48} />
            <div>
              <div class="title" style={{ fontSize: "17px" }}>
                {intro.name}
              </div>
              <div class="meta">{KIND_LABEL[intro.kind]}</div>
            </div>
          </div>
          <div class="hair" style={{ marginTop: "14px", paddingTop: "12px" }}>
            <div class="label">
              {intro.name}’s beacon, in {intro.name}’s words
            </div>
            <p style={{ margin: "8px 0 0", fontSize: "20px", lineHeight: 1.25, letterSpacing: "-.02em" }}>
              <span class="accent">{lead}</span> {rest.join(" ")}
            </p>
          </div>
        </div>
        <p class="meta" style={{ margin: "14px 0 0" }}>
          {intro.why}
        </p>
        <div style={{ flex: 1, minHeight: "18px" }} />
        {answered ? (
          <p class="meta" style={{ paddingBottom: "30px" }}>
            {intro.answer ? `You said yes. If ${intro.name} says yes too, you'll be crew.` : "You said not now. That's the end of it."}
          </p>
        ) : (
          <>
            <div class="stack" style={{ gap: "8px", paddingBottom: "16px" }}>
              <button type="button" class="btn btn-ink" disabled={busy} onClick={() => void answer(true)}>
                Yes, introduce us
              </button>
              <button type="button" class="btn btn-line" disabled={busy} onClick={() => void answer(false)}>
                Not now
              </button>
            </div>
            <p class="label" style={{ lineHeight: 1.5 }}>
              {intro.name} sees your beacon only if you both say yes.
            </p>
            {safety ? (
              <div class="hstack" style={{ gap: "8px", padding: "10px 0 26px" }}>
                <button type="button" class="btn btn-line btn-sm" disabled={busy} onClick={() => void block(false)}>
                  Block
                </button>
                <button type="button" class="btn btn-line btn-sm" style={{ color: "#E5322D" }} disabled={busy} onClick={() => void block(true)}>
                  Block and report
                </button>
              </div>
            ) : (
              <button type="button" class="label" onClick={() => setSafety(true)} style={{ background: "none", border: "none", textAlign: "left", padding: "10px 0 26px", cursor: "pointer", textDecoration: "underline" }}>
                Something feels wrong
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
