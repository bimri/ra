import { useHorizon, KIND_LABEL, ON_THE_HORIZON } from "../../store/horizon";
import { BackHeader } from "../../ui/BackHeader";
import { Icon } from "../../ui/icons";
import { go } from "../../ui/nav";
import {verifiedHorizon} from "@ra/core";
import { InfoTip, GLOSSARY } from "../../ui/Tooltip";

// E2 · Horizon. Signals sit higher the further along they are: risen at the
// top, early just above the line. Below: what stays human here, and how
// open the way in is.

const DAY = 86_400_000;
/** Each kind's place above the horizon line, and its dot (E2). */
const PLACE: Record<string, { top: number; size: number; glow: number; opacity: number; delay: string }> = {
  risen: { top: 20, size: 18, glow: 18, opacity: 1, delay: "0s" },
  rising: { top: 100, size: 14, glow: 13, opacity: 0.75, delay: ".9s" },
  early: { top: 180, size: 10, glow: 8, opacity: 0.5, delay: "1.8s" },
};

function readAgo(at: number | undefined, seeded: boolean): string {
  if (seeded) return "seed · not read yet";
  if (!at) return "";
  const days = Math.floor((Date.now() - at) / DAY);
  return days <= 0 ? "read today" : days === 1 ? "read yesterday" : `read ${days} days ago`;
}

export function HorizonScreen() {
  const horizon = useHorizon();
  const all = horizon?.signals ?? [];
  const signals = all.filter((s) => ON_THE_HORIZON.includes(s.kind)).sort((a, b) => ON_THE_HORIZON.indexOf(a.kind) - ON_THE_HORIZON.indexOf(b.kind));
  // One signal per height: the newest of each kind.
  const shown = ON_THE_HORIZON.map((k) => signals.find((s) => s.kind === k)).filter((s) => s !== undefined);
  const human = all.find((s) => s.kind === "stays-human");
  const onRamp = all.find((s) => s.kind === "on-ramp");
  const checked=all.filter(signal=>verifiedHorizon(signal,Date.now()));
  const newest = Math.max(0, ...checked.map((s) => s.at ?? 0));

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div class="spread">
          <BackHeader to="/chart" title="Horizon" purpose="Where the world near your star is going, with sources." />
          <span class="label">{!checked.length&&all.some(signal=>!signal.seeded)?"source check needed":readAgo(newest || undefined, all.some((s) => s.seeded))}</span>
        </div>
        {horizon?.refresh?.state==="failed"&&<p class="meta" role="status">The latest source check was unavailable. Previous signals are kept with their original dates.</p>}
        {(horizon?.refresh?.state==="queued"||horizon?.refresh?.state==="running")&&<p class="meta" role="status">Checking source evidence…</p>}
        {shown.length === 0 ? (
          <p class="meta" style={{ margin: "14px 0 0" }}>
            No signals yet.
          </p>
        ) : (
          <div style={{ position: "relative", height: "250px", marginTop: "20px", flex: "none" }}>
            {shown.map((s) => {
              const p = PLACE[s.kind]!;
              const to = `/chart/signal?id=${encodeURIComponent(s.id)}`;
              return (
                <a key={s.id} href={to} onClick={go(to)} style={{ position: "absolute", left: 0, right: 0, top: `${p.top}px`, display: "flex", alignItems: "center", gap: "12px", color: "inherit" }}>
                  <span style={{ flex: "none", position: "relative", width: `${p.size}px`, height: `${p.size}px`, borderRadius: "50%", background: "var(--sig)", opacity: p.opacity, boxShadow: `0 0 ${p.glow}px var(--sig)` }}>
                    <span class="halo" style={{ position: "absolute", inset: "-1px", borderRadius: "50%", boxShadow: "0 0 0 1px var(--sig)", animationDelay: p.delay }} />
                  </span>
                  <div class="grow">
                    <div class="label">{KIND_LABEL[s.kind]}</div>
                    <div class="title" style={{ fontSize: "16px", marginTop: "3px" }}>
                      {s.text}
                    </div>
                  </div>
                  <Icon name="arrow" size={16} />
                </a>
              );
            })}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "1px", background: "linear-gradient(90deg,var(--text),color-mix(in srgb,var(--text) 20%,transparent))" }} />
            <span class="label" style={{ position: "absolute", right: 0, bottom: "6px" }}>
              horizon
            </span>
          </div>
        )}
        {human && (
          <div class="card" style={{ marginTop: "20px", flex: "none" }}>
            <div class="label">Stays human here</div>
            <div class="title" style={{ fontSize: "16px", marginTop: "8px" }}>
              {human.text}
            </div>
            <a class="accent" style={{fontSize:"13px",display:"inline-block",marginTop:"8px"}} href={`/chart/signal?id=${encodeURIComponent(human.id)}`} onClick={go(`/chart/signal?id=${encodeURIComponent(human.id)}`)}>Sources</a>
          </div>
        )}
        {onRamp && (
          <div class="hstack" style={{ marginTop: "14px", gap: "8px", alignItems: "flex-start" }}>
            <span style={{ flex: "none", width: "6px", height: "6px", marginTop: "7px", borderRadius: "50%", background: "var(--sig)" }} />
            <span class="meta">
              <b style={{ color: "var(--text)", fontWeight: 500 }}>On-ramp open.</b> {onRamp.text}
              {" "}<a class="accent" href={`/chart/signal?id=${encodeURIComponent(onRamp.id)}`} onClick={go(`/chart/signal?id=${encodeURIComponent(onRamp.id)}`)}>Sources</a>
            </span>
          </div>
        )}
        <div style={{ flex: 1, minHeight: "28px" }} />
      </div>
    </div>
  );
}
