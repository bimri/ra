import type { CrewKind, Views } from "@ra/core";
import { useEffect, useState } from "preact/hooks";
import { api } from "../../store/device";
import { mind, useMind } from "../../store/mind";
import { Dock } from "../../ui/Dock";
import { Icon } from "../../ui/icons";
import { go } from "../../ui/nav";

// H3 · Your crew. A handful of people Ra introduced, then stepped back from:
// no feed, no likes. A crewmate asking you to witness their landfall shows
// here; so does an introduction waiting for your yes.

export const KIND_LABEL: Record<CrewKind, string> = {
  "same-star": "Same star",
  "neighbouring-star": "Neighbouring star",
  ahead: "A few islands ahead",
  behind: "A few islands behind",
};

const TINTS = ["#F2C9B8", "#D9DEE8", "#CFE3D4", "#F2E2B8"];
export const tint = (name: string) => TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length]!;

export function Avatar({ name, size = 40, you = false }: { name: string; size?: number; you?: boolean }) {
  return (
    <span class="avatar" aria-hidden="true" style={{ width: `${size}px`, height: `${size}px`, background: you ? "var(--sig)" : tint(name), fontSize: `${Math.round(size * 0.38)}px` }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function ContactControls({ crew }: { crew: Views["crew"][number] }) {
  const [editing,setEditing] = useState(false);
  const [value,setValue] = useState(crew.sharedContact ?? "");
  const [busy,setBusy] = useState(false);
  const [problem,setProblem] = useState("");
  useEffect(() => setValue(crew.sharedContact ?? ""),[crew.sharedContact]);
  const received = (() => { try { return crew.contact && ["https:","mailto:","tel:"].includes(new URL(crew.contact).protocol) ? crew.contact : null; } catch { return null; } })();
  async function share(remove = false) {
    setBusy(true); setProblem("");
    try {
      const response = await fetch(api("/people/contact"),{ method: remove ? "DELETE" : "POST", credentials: "include", headers: { "content-type":"application/json" }, body: JSON.stringify({ introId: crew.introId, ...(remove ? {} : { value }) }) });
      if (!response.ok) throw new Error(await response.text());
      await mind().sync(); setEditing(false);
    } catch (error) { setProblem(error instanceof Error ? error.message : "The contact could not be saved."); }
    finally { setBusy(false); }
  }
  // H3 keeps each crewmate to one line; contact is a pill beside it, and the form opens only when asked.
  return <div>
    {!editing && <div class="hstack" style={{ gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
      {received && <a class="pill on" href={received} target="_blank" rel="noreferrer noopener">Reach {crew.name}</a>}
      <button type="button" class="pill" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={() => setEditing(true)}>{crew.sharedContact ? "You shared a contact · change" : "Share how to reach you"}</button>
      {crew.sharedContact && <button type="button" class="pill" style={{ background: "none", border: "none", cursor: "pointer" }} disabled={busy} onClick={() => void share(true)}>Withdraw</button>}
    </div>}
    {editing ? <div class="stack" style={{ gap: "8px", marginTop: "8px" }}>
      <input class="field" aria-label={"Contact link for " + crew.name} placeholder="https://…, mailto:… or tel:…" maxlength={240} value={value} onInput={(e) => setValue(e.currentTarget.value)} />
      <span class="meta">Only {crew.name} gets this link.</span>
      <button class="btn btn-ink btn-sm" disabled={busy || !value.trim()} onClick={() => void share()}>Share with {crew.name}</button>
      <button class="btn btn-line btn-sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
    </div> : null}
    {problem && <p class="meta" role="alert">{problem}</p>}
  </div>;
}

export function CrewScreen() {
  const { views } = useMind();
  const [answering, setAnswering] = useState<string | null>(null);
  const beacon = views.beacon;
  const waiting = views.intros.filter((i) => i.answer === null).at(-1);
  const asks = views.witnessAsks.filter((w) => w.saw === null);
  const island = Object.keys(views.markers).at(-1) ?? null;

  async function witness(requestId: string, saw: boolean) {
    setAnswering(requestId);
    await fetch(api("/people/witness/answer"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, saw }), credentials: "include" }).catch(() => null);
    await mind().sync();
    setAnswering(null);
  }

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: "0 0 84px 0", padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
          <span class="label">Your crew · {views.crew.length + 1}</span>
          <a href="/beacon" onClick={go("/beacon")} class="pill">
            {beacon?.lit && <span class="d" />}
            Beacon {beacon?.lit ? "on" : "off"}
          </a>
        </header>
        <div class="h1" style={{ marginTop: "18px" }}>
          {views.star.current ?? "No star yet"}
        </div>

        {waiting && (
          <a href={`/intro?id=${waiting.introId}`} onClick={go(`/intro?id=${waiting.introId}`)} class="card" style={{ marginTop: "16px", display: "block", color: "inherit" }}>
            <div class="spread">
              <span class="label" style={{ color: "var(--sig)" }}>
                An introduction
              </span>
              <Icon name="arrow" size={16} />
            </div>
            <div class="title" style={{ fontSize: "16px", marginTop: "8px" }}>
              {waiting.name} · {KIND_LABEL[waiting.kind].toLowerCase()}. Would you like to meet?
            </div>
          </a>
        )}

        <div style={{ marginTop: "14px" }}>
          {views.crew.map((c) => (
            <div key={c.introId} class="row">
              <Avatar name={c.name} />
              <div class="grow">
                <div class="title" style={{ fontSize: "15px" }}>
                  {c.name}
                </div>
                <div class="meta">
                  {KIND_LABEL[c.kind]} · {c.beacon}
                </div>
                <ContactControls crew={c} />
              </div>
            </div>
          ))}
          <div class="row">
            <Avatar name={beacon?.name ?? "You"} you />
            <div class="grow">
              <div class="title" style={{ fontSize: "15px" }}>
                You
              </div>
              <div class="meta">{island ? `${island} · next island` : "Your route is being drawn"}</div>
            </div>
          </div>
        </div>

        {asks.map((w) => (
          <div key={w.requestId} class="card" style={{ marginTop: "16px", boxShadow: "inset 0 0 0 1.5px var(--sig),0 0 0 5px color-mix(in srgb,var(--sig) 10%,transparent)" }}>
            <div class="spread">
              <span class="hstack" style={{ gap: "8px", color: "var(--sig)" }}>
                <Icon name="witness" size={18} />
                <span class="label" style={{ color: "var(--sig)" }}>
                  Witness asked
                </span>
              </span>
              <span class="label">{w.name}</span>
            </div>
            <div class="title" style={{ fontSize: "16px", marginTop: "8px" }}>
              {w.text}
            </div>
            <div class="hstack" style={{ gap: "8px", marginTop: "12px" }}>
              <button type="button" class="btn btn-ink btn-sm" disabled={answering === w.requestId} onClick={() => void witness(w.requestId, true)}>
                I saw it
              </button>
              <button type="button" class="btn btn-line btn-sm" disabled={answering === w.requestId} onClick={() => void witness(w.requestId, false)}>
                Not yet
              </button>
            </div>
          </div>
        ))}

        {views.crew.length === 0 && !waiting && (
          <p class="meta" style={{ margin: "14px 0 0" }}>
            {beacon?.lit ? "Your beacon is shining. Ra introduces you to someone only when it finds a real fit, and only with two yeses." : "Light your beacon and Ra looks for people steering by stars like yours. Your mind never leaves."}
          </p>
        )}
        <p class="meta" style={{ margin: "12px 0 24px" }}>
          Ra introduced you, then stepped back. Talk wherever you like; your contact stays private until you share it.
        </p>
      </div>
      <Dock here="/crews" />
    </div>
  );
}
