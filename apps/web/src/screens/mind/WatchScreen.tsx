import { useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { GlBox } from "../../sky/GlBox";
import { moonAt, moonPath } from "../../ui/moon";

// I3 · The Watch. While you slept, Ra read the day again: the night's log,
// under that night's moon. It only wakes you when something needs you, and
// so far nothing has (the interruption governor comes with the Ear).

/** Scattered stars for the flat sky, the same every time. */
const STARS = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1) * 390, y: r(2) * 680, r: r(3) > 0.92 ? 1.1 : 0.6, o: 0.26 + r(4) * 0.58 };
});

const MOON = { cx: 296.4, cy: 128, r: 39 };

function Sky({ at }: { at: number }) {
  const m = moonAt(at);
  return (
    <svg viewBox="0 0 390 844" preserveAspectRatio="xMidYMin slice" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {STARS.map((s, i) => (
        <circle key={i} cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={s.r} fill="var(--text)" opacity={s.o.toFixed(2)} />
      ))}
      <circle cx={MOON.cx} cy={MOON.cy} r={MOON.r * 5} fill="none" stroke="#C9D3EA" stroke-width={MOON.r / 2} opacity=".05" />
      <circle cx={MOON.cx} cy={MOON.cy} r={MOON.r * 1.8} fill="#C9D3EA" opacity=".06" />
      <circle cx={MOON.cx} cy={MOON.cy} r={MOON.r} fill="#1A1F2C" />
      {m.lit > 0.01 && <path d={moonPath(m, MOON.cx, MOON.cy, MOON.r)} fill="#E9EBF0" />}
      <line x1="0" y1="730" x2="390" y2="730" stroke="#C9D3EA" stroke-width=".6" opacity=".35" />
      {/* The moon's road on the water: shorter and fainter towards you. */}
      {[18, 24, 20, 13, 15, 25, 17].map((w, i) => (
        <rect key={i} x={MOON.cx - w / 2 + ((i * 7) % 11) - 5} y={738 + i * 14} width={w * (0.4 + m.lit * 0.6)} height="1.4" rx=".7" fill="#E9EBF0" opacity={(0.7 - i * 0.08).toFixed(2)} />
      ))}
    </svg>
  );
}

export function WatchScreen() {
  const { views } = useMind();
  const nights = Object.keys(views.nightLogs).sort();
  const night = nights.at(-1);
  const lines = night ? views.nightLogs[night]!.map((l) => ({ time: l.slice(0, 5), text: l.slice(6) || l })) : [];
  // The moon of that night, at the Watch's hour; tonight's if it hasn't run yet.
  const at = night ? new Date(`${night}T02:00:00`).getTime() : Date.now();
  const moon = moonAt(at);

  return (
    <div class="ui">
      {/* I3's night sea under that night's moon; the flat sky beneath it. */}
      <GlBox
        scene="sea"
        options={{ hz: 0.865, sx: 0.76, sr: 0.1, el: 15.44, voice: "calm", fov: 30, body: "moon", phase: moon.turn, cloud: 0.7, stars: 1, fade: 0 }}
        style={{ position: "absolute", inset: 0 }}
      >
        <Sky at={at} />
      </GlBox>
      <span class="label" style={{ position: "absolute", right: "14px", width: "160px", textAlign: "center", top: "187px", fontSize: "9px", letterSpacing: ".1em" }}>
        {moon.name} · {Math.round(moon.lit * 100)}%
      </span>
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <BackHeader to="/mind" title="The Watch" purpose="What Ra did while you slept." />
        <div class="h1" style={{ marginTop: "48px", fontSize: "48px", maxWidth: "220px" }}>
          While you slept
        </div>
        {lines.length === 0 ? (
          <p class="meta" style={{ margin: "18px 0 0", maxWidth: "260px", fontSize: "15px" }}>
            Runs after your first Ray, about 2 AM.
          </p>
        ) : (
          <div style={{ marginTop: "26px" }}>
            {lines.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "12px 0" }}>
                <span class="dot" style={{ fontSize: "18px", width: "60px", flex: "none", lineHeight: 1.2 }}>
                  {l.time}
                </span>
                <span style={{ flex: "none", width: "12px", alignSelf: "stretch", position: "relative" }}>
                  {lines.length > 1 && (
                    <i
                      style={{
                        position: "absolute",
                        left: "5.5px",
                        width: "1px",
                        top: i === 0 ? "10px" : "0px",
                        bottom: i === lines.length - 1 ? "calc(100% - 10px)" : "-1px",
                        background: "var(--line)",
                      }}
                    />
                  )}
                  <i
                    style={{
                      position: "absolute",
                      left: "2.5px",
                      top: "6px",
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      // What changed something you'll see glows (a signal moved, a line of Ra's that slipped).
                      background: /signal|slipped/i.test(l.text) ? "var(--sig)" : "var(--text)",
                      boxShadow: /signal|slipped/i.test(l.text) ? "0 0 0 3px var(--bg),0 0 10px var(--sig)" : "0 0 0 3px var(--bg)",
                    }}
                  />
                </span>
                <span class="grow" style={{ fontSize: "16px", lineHeight: 1.35 }}>
                  {l.text}
                </span>
              </div>
            ))}
          </div>
        )}
        <div class="card glass" style={{ marginTop: "18px", flex: "none" }}>
          <div class="label">Woke you for</div>
          <div class="h2" style={{ marginTop: "8px" }}>
            Nothing.
          </div>
        </div>
        <div style={{ flex: 1, minHeight: "28px" }} />
      </div>
    </div>
  );
}
