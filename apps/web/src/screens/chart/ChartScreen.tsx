import { ALONG, KIND_LABEL, ON_THE_HORIZON, useHorizon } from "../../store/horizon";
import {currentIsland,todayOrTonight} from "@ra/core";
import { useMind } from "../../store/mind";
import { Dock } from "../../ui/Dock";
import { Icon } from "../../ui/icons";
import { go } from "../../ui/nav";
import { RouteLine } from "./RouteLine";

// E1 · Chart: your star, your next island and its markers, your horizon, and
// your Dial calls. J5 when there's no star yet: curiosity is the compass.


export function ChartScreen() {
  const { views } = useMind();
  const horizon = useHorizon();
  const star = views.star.current;
  const island = currentIsland(views);
  const markers = island ? views.markers[island]??null : null;
  const islandView = island ? views.islands[island] : undefined;
  const reached = markers ? markers.markers.filter((text) => views.markerAchievements.some((a) => a.island === island && a.marker === text)) : [];
  const calls = Object.keys(views.dial).length;
  const signals = (horizon?.signals ?? []).filter((s) => ON_THE_HORIZON.includes(s.kind)).sort((a, b) => ON_THE_HORIZON.indexOf(a.kind) - ON_THE_HORIZON.indexOf(b.kind));
  const threads = Object.values(views.mirrors)
    .filter((m) => m.state === "kept")
    .map((m) => m.text)
    .slice(-4);
  const trip = Object.values(views.trips).filter((t) => t.state !== "offered").at(-1);

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: "0 0 84px 0", padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
          <span class="label">Your chart · {todayOrTonight(new Date().getHours())}</span>
          <span class="hstack" style={{ gap: "6px" }}>
            <a href="/chart/ask" onClick={go("/chart/ask")} class="pill">
              Ask
            </a>
            <a href="/chart/dial" onClick={go("/chart/dial")} class="pill">
              <Icon name="dial" size={14} />
              Dial · {calls} {calls === 1 ? "call" : "calls"}
            </a>
          </span>
        </header>

        {star ? (
          <>
            <div class="h1" style={{ marginTop: "20px", fontSize: "34px" }}>
              {star}
            </div>
            {island && <RouteLine you={islandView?.yours ?? ""} island={island} after={islandView?.inevitable ?? "later"} />}
          </>
        ) : (
          // J5 · No star yet: a faint star that isn't yours, and what Ra has noticed so far.
          <>
            <div class="spread" style={{ alignItems: "flex-end", marginTop: "22px" }}>
              <div class="big" style={{ fontSize: "64px", lineHeight: 0.9 }}>
                No star yet.
              </div>
              <div style={{ opacity: 0.35, marginBottom: "6px" }}>
                <svg width="56" height="56" viewBox="-60 -60 120 120" role="img" aria-label="A faint star, not yet yours" style={{ display: "block", overflow: "visible" }}>
                  <circle r="44" fill="var(--sig)" opacity=".07" />
                  <circle class="halo" r="16" fill="none" stroke="var(--sig)" stroke-width=".8" />
                  <circle class="halo" r="16" fill="none" stroke="var(--sig)" stroke-width=".8" style={{ animationDelay: "1.8s" }} />
                  <g class="tw">
                    <path d="M0 -58C1.4 -14 14 -1.4 58 0C14 1.4 1.4 14 0 58C-1.4 14 -14 1.4 -58 0C-14 -1.4 -1.4 -14 0 -58Z" fill="var(--sig)" />
                    <path d="M0 -24C.8 -5 5 -.8 24 0C5 .8 .8 5 0 24C-.8 5 -5 .8 -24 0C-5 -.8 -.8 -5 0 -24Z" fill="var(--sig)" opacity=".55" transform="rotate(45)" />
                    <circle r="6.5" fill="#FFF3E6" />
                  </g>
                </svg>
              </div>
            </div>
            {threads.length > 0 && (
              <>
                <div class="label" style={{ marginTop: "22px" }}>
                  Threads Ra has noticed
                </div>
                <div class="hstack" style={{ gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                  {threads.map((t) => (
                    <span key={t} class="pill">
                      <span class="d" />
                      {t}
                    </span>
                  ))}
                </div>
              </>
            )}
            {trip && (
              <a href="/bring-back" onClick={go("/bring-back")} class="card" style={{ display: "block", marginTop: "20px", color: "inherit" }}>
                <div class="spread">
                  <span class="label">Scouting trip in progress</span>
                  <Icon name="arrow" size={18} />
                </div>
                <div class="title" style={{ fontSize: "16px", marginTop: "8px" }}>
                  {trip.title ?? trip.action}
                </div>
                {trip.state === "chosen" && (
                  <div class="meter" style={{ marginTop: "12px", height: "4px" }}>
                    <i class="dither" style={{ width: "50%" }} />
                  </div>
                )}
              </a>
            )}
          </>
        )}

        <a href="/chart/island" onClick={go("/chart/island")} class="card" style={{ marginTop: "14px", display: "block", color: "inherit" }}>
          <div class="spread">
            <span class="hstack" style={{ gap: "8px" }}>
              <Icon name="island" size={18} />
              <span class="label">Next island</span>
            </span>
            <Icon name="arrow" size={18} />
          </div>
          <div class="h2" style={{ marginTop: "8px" }}>
            {island ?? "Not charted yet"}
          </div>
          {markers ? (
            <>
              <div class="spread" style={{ marginTop: "12px" }}>
                <span class="meta">Markers</span>
                <span class="mono" style={{ fontSize: "12px" }}>
                  {reached.length} / {markers.markers.length}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, markers.markers.length)},1fr)`, gap: "4px", marginTop: "6px" }}>
                {markers.markers.map((m) => (
                  <i key={m} style={{ display: "block", height: "3px", borderRadius: "2px", background: reached.includes(m) ? "var(--sig)" : "var(--line)" }} />
                ))}
              </div>
            </>
          ) : (
            <p class="meta" style={{ margin: "8px 0 0" }}>
              No markers yet.
            </p>
          )}
        </a>

        {!island && <a href="/chart/route" onClick={go("/chart/route")} class="btn btn-line" style={{marginTop:"10px",flex:"none"}}>Consider your next island</a>}

        <div class="card" style={{ marginTop: "10px", marginBottom: "24px" }}>
          <div class="spread">
            <span class="hstack" style={{ gap: "8px" }}>
              <Icon name="horizon" size={18} />
              <a href="/chart/horizon" onClick={go("/chart/horizon")} class="label">
                Horizon · {signals.length} {signals.length === 1 ? "signal" : "signals"}
                {horizon?.field ? ` · ${horizon.field.name}` : ""}
              </a>
            </span>
            {signals.some((s) => s.seeded) && (
              <span class="label" style={{ color: "var(--faint)" }}>
                seed
              </span>
            )}
          </div>
          {signals.length === 0 && (
            <p class="meta" style={{ margin: "10px 0 0" }}>
              No signals yet.
            </p>
          )}
          {signals.map((s) => (
            <a key={s.id} href={`/chart/signal?id=${encodeURIComponent(s.id)}`} onClick={go(`/chart/signal?id=${encodeURIComponent(s.id)}`)} class="hstack" style={{ marginTop: "10px", gap: "10px", color: "inherit" }}>
              <span class="label" style={{ width: "52px" }}>
                {KIND_LABEL[s.kind]}
              </span>
              <span style={{ flex: 1, fontSize: "14px" }}>{s.text}</span>
              <span class="meter" style={{ width: "44px", height: "5px" }}>
                <i class="dither" style={{ width: `${ALONG[s.kind]}%` }} />
              </span>
            </a>
          ))}
        </div>
      </div>
      <Dock here="/chart" />
    </div>
  );
}
