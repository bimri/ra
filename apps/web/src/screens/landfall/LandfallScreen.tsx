import { MarkerProgress } from "../chart/MarkerProgress";
import { useState } from "preact/hooks";
import {currentIsland} from "@ra/core";
import { api } from "../../store/device";
import { mind, useMind } from "../../store/mind";
import { GlBox } from "../../sky/GlBox";
import { BackHeader } from "../../ui/BackHeader";
import { ISLAND_SVG } from "../../ui/art/island";
import { Icon } from "../../ui/icons";
import { go, navigate } from "../../ui/nav";

// G4 · Landfall. You say you've arrived: your evidence against the markers
// you named, in your own words, and crewmates asked to witness it. A
// witness's "I saw it" lands here once D1 confirms you share a crew.

const DAY = 86_400_000;
const long = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function Check({ delay }: { delay: number }) {
  return (
    <span style={{ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "26px", height: "26px", borderRadius: "50%", background: "var(--ink)", color: "var(--on-ink)" }}>
      <svg class="chk" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path pathLength={1} d="m5 12.5 4.5 4.5L19 7.5" style={{ animationDelay: `${delay}s` }} />
      </svg>
    </span>
  );
}

export function LandfallScreen() {
  const { views } = useMind();
  // The island you came from (E4 "I've arrived"), else the one you're on; markers may not be named yet.
  const island = new URLSearchParams(location.search).get("island") ?? currentIsland(views);
  const markers = island ? (views.markers[island]?.markers ?? []) : [];
  const made = views.landfalls.find((l) => l.island === island);
  const complete = markers.length > 0 && markers.every((text) => views.markerAchievements.some((a) => a.island === island && a.marker === text));
  const [problem,setProblem] = useState("");
  const [said, setSaid] = useState("");
  const [asked, setAsked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const firstRay = Math.min(...Object.values(views.rays).map((r) => r.startedAt));

  async function arrive() {
    if (!island) return;
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch(api("/landfall/prepare"),{ method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({ island,said,witnesses:asked }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The landfall review could not open.");
      await mind().sync();
      navigate("/ray?session=landfall&landfall="+encodeURIComponent(result.landfallId));
    } catch (error) { setProblem(error instanceof Error ? error.message : "The landfall review could not open."); }

    setBusy(false);
  }

  if (!island) {
    return (
      <div class="ui">
        <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
          <BackHeader to="/chart/island" title="Landfall" purpose="You reached every marker. Look at the evidence, then make it yours." />
          <p class="meta" style={{ margin: "18px 0 0" }}>
            Landfall comes once you've named the markers for an island.
          </p>
        </div>
      </div>
    );
  }

  // G4 as it was made.
  if (made) {
    const day = Number.isFinite(firstRay) ? Math.max(1, Math.round((made.at - firstRay) / DAY)) : null;
    return (
      <div class="ui">
        <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
            <a href="/chart" onClick={go("/chart")} class="label" style={{ color: "var(--text)" }}>
              Landfall · {long(made.at)}
            </a>
            {day && <span class="label">day {day}</span>}
          </header>
          <GlBox scene="island" options={{}} label={`${made.island}: landfall`} style={{ height: "210px", margin: "0 -20px", flex: "none" }}>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: ISLAND_SVG }} />
          </GlBox>
          <div class="big" style={{ fontSize: "84px", marginTop: "2px" }}>
            Landfall.
          </div>
          <div class="h2" style={{ marginTop: "8px" }}>
            {made.island}
          </div>
          <div style={{ marginTop: "12px" }}>
            {made.markers.map((m, i) => (
              <div key={m.text} class="row" style={{ alignItems: "flex-start", padding: "10px 0" }}>
                <Check delay={0.5 + i * 0.25} />
                <div class="grow">
                  <div style={{ fontSize: "15px", lineHeight: 1.3 }}>{m.text}</div>
                  {m.evidence && (
                    <div class="label" style={{ marginTop: "4px" }}>
                      {m.evidence}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {made.witnesses.length > 0 && (
            <p class="label" style={{ margin: "8px 0 0" }}>
              {made.witnessedBy.length ? `Witness · ${made.witnessedBy.join(", ")}` : `Asked to witness · ${made.witnesses.join(", ")}`}
            </p>
          )}
          {made.said && (
            <p class="serif" style={{ margin: "10px 0 0", fontSize: "22px", fontStyle: "italic", lineHeight: 1.2 }}>
              “{made.said}”
            </p>
          )}
          <div style={{ flex: 1, minHeight: "18px" }} />
          <div class="hstack" style={{ gap: "8px", paddingBottom: "28px" }}>
            <a href="/rings" onClick={go("/rings")} class="btn btn-ink" style={{ flex: 1 }}>
              <Icon name="rings" size={18} /> In your rings
            </a>
            <a href={`/share?landfall=${made.landfallId}`} onClick={go(`/share?landfall=${made.landfallId}`)} class="btn btn-line">
              Share
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Saying you've arrived.
  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <BackHeader to="/chart/island" title="Landfall" purpose="You reached every marker. Look at the evidence, then make it yours." />
        <div class="h1" style={{ marginTop: "14px", fontSize: "34px" }}>
          You've reached {island.toLowerCase()}?
        </div>
        <p class="meta" style={{ margin: "10px 0 0" }}>
          Say how you know each one.
        </p>
        <div style={{ marginTop: "12px" }}>
          <MarkerProgress island={island} />
        </div>
        <label class="label" for="landfall-said" style={{ marginTop: "14px" }}>
          In your words: what's it like now?
        </label>
        <textarea
          id="landfall-said"
          rows={2}
          placeholder="“Like I’m not guessing any more.”"
          value={said}
          onInput={(e) => setSaid((e.target as HTMLTextAreaElement).value)}
          style={{ marginTop: "8px", font: "italic 20px 'Instrument Serif',serif", color: "var(--text)", background: "transparent", border: "none", borderBottom: "1px solid var(--line)", resize: "none", outline: "none", padding: "4px 0" }}
        />
        {views.crew.length > 0 && (
          <>
            <div class="label" style={{ marginTop: "18px" }}>
              Ask crew to witness it
            </div>
            {views.crew.map((c) => (
              <label key={c.introId} class="row" style={{ cursor: "pointer" }}>
                <span class="grow" style={{ fontSize: "15px" }}>
                  {c.name}
                </span>
                <input type="checkbox" checked={asked.includes(c.introId)} onChange={(e) => setAsked((a) => ((e.target as HTMLInputElement).checked ? [...a, c.introId] : a.filter((x) => x !== c.introId)))} />
              </label>
            ))}
          </>
        )}
        {problem && <p class="meta" role="alert">{problem}</p>}
        <div style={{ flex: 1, minHeight: "18px" }} />
        <div style={{ paddingBottom: "28px" }}>
          <button type="button" class="btn btn-ink" style={{ width: "100%" }} disabled={busy || !complete} onClick={() => void arrive()}>
            <Icon name="flag" size={18} /> Review this landfall with Ra
          </button>
        </div>
      </div>
    </div>
  );
}
