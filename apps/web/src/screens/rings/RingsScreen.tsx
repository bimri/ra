import { useState } from "preact/hooks";
import { mind, useMind } from "../../store/mind";
import { Dock } from "../../ui/Dock";
import { GlBox } from "../../sky/GlBox";
import { Icon } from "../../ui/icons";
import { go } from "../../ui/nav";
import { Tip } from "../../ui/Tooltip";

// U5 · Rings: your growth record, a year at a time. Counted from your Mind's
// events: Rays, captures, landfalls, crewmates; and your rings, newest last.
// The ring vessel (three.js) draws over this flat version once the sky lands.

type Scope = "year" | "seasons" | "all";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function RingsScreen() {
  const { views } = useMind();
  const [scope, setScope] = useState<Scope>("year");
  const rays = Object.values(views.rays);
  const first = rays.reduce<number | null>((a, r) => (a === null || r.startedAt < a ? r.startedAt : a), null);
  // Your year starts the month of your first Ray (U5: "year one · oct – sep").
  const start = first !== null ? new Date(first) : new Date();
  const yearNumber = first !== null ? Math.floor((Date.now() - first) / (365.25 * 86_400_000)) + 1 : 1;
  const span = `${MONTHS[start.getMonth()]} – ${MONTHS[(start.getMonth() + 11) % 12]}`;
  const captures = views.captures;
  // A ring per month of your year, as wide as the Rays you had in it (a quiet month is still a thin ring).
  const yearStart = first !== null ? first + (yearNumber - 1) * 365.25 * 86_400_000 : Date.now();
  const thisYear = rays.filter((r) => r.startedAt >= yearStart);
  const monthOf = (at: number) => (new Date(at).getMonth() - start.getMonth() + 12) % 12;
  const counts =
    scope === "year"
      ? Array.from({ length: 12 }, (_, i) => thisYear.filter((r) => monthOf(r.startedAt) === i).length)
      : scope === "seasons"
        ? Array.from({ length: 4 }, (_, i) => thisYear.filter((r) => Math.floor(monthOf(r.startedAt) / 3) === i).length)
        : Array.from({ length: yearNumber }, (_, i) => rays.filter((r) => first !== null && Math.floor((r.startedAt - first) / (365.25 * 86_400_000)) === i).length);
  const most = Math.max(1, ...counts);
  const widths = counts.map((n) => 0.22 + 0.78 * (n / most));
  const ringLabel =
    scope === "year"
      ? "Your year as twelve growth rings, one for each month; the wider the ring, the more Rays that month"
      : scope === "seasons"
        ? "Your year as four growth rings, one for each season; the wider the ring, the more Rays that season"
        : `All your years as ${counts.length} growth ${counts.length === 1 ? "ring" : "rings"}; the wider the ring, the more Rays that year`;
  const landfall = views.landfalls.at(-1);
  const rings = views.rings;
  // G2: each ring plays what you came in with that Ray, in your own voice.
  const said = mind().utterances();
  const firstWords = (rayId: string | null) => said.find((u) => u.speaker === "you" && u.rayId === rayId) ?? null;

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: "0 0 84px 0", padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <header class="spread" style={{ minHeight: "44px" }}>
          <span class="label">Rings</span>
          {landfall ? (
            <a href={`/share?landfall=${landfall.landfallId}`} onClick={go(`/share?landfall=${landfall.landfallId}`)} class="btn btn-line btn-sm">
              <Icon name="flag" size={16} /> Share landfall
            </a>
          ) : (
            <Tip text="Sharing opens with your first landfall"><span><button type="button" class="btn btn-line btn-sm" disabled>
              <Icon name="flag" size={16} /> Share landfall
            </button></span></Tip>
          )}
        </header>
        <div class="spread" style={{ alignItems: "flex-end", marginTop: "14px" }}>
          <div class="big" style={{ fontSize: "84px" }}>
            {start.getFullYear() + yearNumber - 1}
          </div>
          <div class="label" style={{ textAlign: "right", marginBottom: "8px" }}>
            year {["one", "two", "three", "four", "five"][yearNumber - 1] ?? yearNumber}
            <br />
            {span}
          </div>
        </div>
        <div class="seg" role="tablist" aria-label="Rings by" style={{ marginTop: "16px" }}>
          {([["year", "Year"], ["seasons", "Seasons"], ["all", "All years"]] as const).map(([id, name]) => (
            <button type="button" key={id} role="tab" aria-selected={scope === id} class={scope === id ? "on" : ""} onClick={() => setScope(id)}>
              {name}
            </button>
          ))}
        </div>
        <div class="card" style={{ marginTop: "14px", padding: 0, height: "250px", position: "relative", overflow: "hidden" }}>
          <GlBox
            scene="rings"
            options={{ n: counts.length, widths, land: -1 }}
            label={ringLabel}
            style={{ position: "absolute", left: "50%", top: "50%", width: "230px", height: "230px", margin: "-115px 0 0 -115px" }}
          >
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sig)", opacity: 0.85 }}>
              <Icon name="rings" size={150} strokeWidth={0.6} />
            </div>
          </GlBox>
          <Count at="tl" n={rays.length} label="Rays" />
          <Count at="tr" n={captures} label="captures" />
          <Count at="bl" n={views.landfalls.length} label="landfall" accent />
          <Count at="br" n={views.crew.length} label="crewmates" />
        </div>
        <div style={{ margin: "18px 0 24px" }}>
          <div class="label" style={{ marginBottom: "4px" }}>
            Hear yourself from then
          </div>
          {views.thenAndNow.length > 0 && (
            // G3: the Watch found you explaining the same thing, months apart.
            <a href="/then" onClick={go("/then")} class="row">
              <span class="grow title" style={{ fontSize: "15px" }}>
                Then and now · {views.thenAndNow.at(-1)!.apart}
              </span>
              <Icon name="arrow" size={16} />
            </a>
          )}
          {rings.length === 0 && (
            <div class="row">
              <div class="grow meta">No rings yet.</div>
            </div>
          )}
          {[...rings].reverse().map((r) => {
            const then = firstWords(r.rayId);
            const to = then ? `/playback?id=${encodeURIComponent(then.utteranceId)}` : null;
            return (
            <div class="row" key={r.ringId}>
              {to ? (
                <Tip text="Hear yourself from then"><a href={to} onClick={go(to)} class="key" aria-label="Hear yourself from then" style={{ width: "38px", height: "38px" }}>
                  <Icon name="play" size={16} />
                </a></Tip>
              ) : (
                <span class="key" aria-hidden="true" style={{ width: "38px", height: "38px", opacity: 0.4 }}>
                  <Icon name="play" size={16} />
                </span>
              )}
              <div class="grow">
                <div class="title" style={{ fontSize: "15px" }}>
                  “{r.text}”
                </div>
                <div class="meta">
                  {r.title} · {new Date(r.at).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>
      <Dock here="/rings" />
    </div>
  );
}

function Count({ at, n, label, accent }: { at: "tl" | "tr" | "bl" | "br"; n: number; label: string; accent?: boolean }) {
  const pos = {
    tl: { left: "16px", top: "16px" },
    tr: { right: "16px", top: "16px", textAlign: "right" as const },
    bl: { left: "16px", bottom: "16px" },
    br: { right: "16px", bottom: "16px", textAlign: "right" as const },
  }[at];
  return (
    <div style={{ position: "absolute", pointerEvents: "none", ...pos }}>
      <div class={`big${accent ? " accent" : ""}`} style={{ fontSize: "28px" }}>
        {n}
      </div>
      <div class="label" style={{ marginTop: "4px" }}>
        {label}
      </div>
    </div>
  );
}
