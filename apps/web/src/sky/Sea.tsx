// The sea and the sun (U4 and the boards that share it): the three.js scene
// from App UI v2 over its flat, dotted version, which stays for weak GPUs,
// "sky off" and until the scene draws.

import { GlBox } from "./GlBox";

/** Ra's voice on the water: ripples spread while you talk, settle while Ra speaks. */
export type SeaVoice = "listen" | "speak" | "calm" | "idle";

/** U4's sky box: 544 of the board's 844 px, anchored to the bottom. C2 uses 444. */
const BOX = 544;

/** Glints on the water under the sun, from U4's fallback layer. */
const GLINTS = Array.from({ length: 21 }, (_, i) => {
  const row = i / 20;
  const rand = (n: number) => {
    const x = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const minor = i % 3 === 1;
  const width = minor ? 3 + rand(1) * 17 : 10 + (1 - row) * 47 * (0.6 + rand(2) * 0.4);
  return {
    offset: Math.round((rand(3) - 0.5) * 40 - width / 2 + (minor ? 25 : 0)),
    top: Math.round(4 + row * row * 215),
    width: Math.round(width),
    height: minor ? 1.2 : +(1.4 + row * 2.3).toFixed(1),
    x: +(2 + row * 10.4 + (minor ? 3 : 0)).toFixed(1),
    d: +(1.5 + rand(4) * 1.8).toFixed(2),
    dl: -+(rand(5) * 2.5).toFixed(2),
    o1: minor ? 0.15 : +(0.55 - row * 0.28).toFixed(2),
    o2: minor ? 0.5 : +(1 - row * 0.37).toFixed(2),
  };
});

export function Sea({
  sunSink,
  horizonAt = 294,
  voice = "listen",
  scene = {},
  box = BOX,
  sky = "sea",
}: {
  sunSink: number;
  horizonAt?: number;
  voice?: SeaVoice;
  /** Anything else the board passes the scene (C2's horizon, for one). */
  scene?: Record<string, unknown>;
  /** Height of the sky box, as on the board. */
  box?: number;
  /** "ray": the Ray screen's own sky (a luminous sun over a halftone sea); "sea" is the boards' scene. */
  sky?: "sea" | "ray";
}) {
  // The sun lowers toward the horizon as the Ray goes on.
  const sunTop = 175 + sunSink * 110;
  return (
    // Anchored to the bottom at the board's height (U4: 544 of 844 px), so the
    // horizon keeps its place above the card on any phone height.
    <GlBox
      scene={sky}
      options={{ hz: horizonAt / box, sx: 0.5, sr: 0.12, sink: sunSink, voice, ...scene }}
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${box}px` }}
    >
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${horizonAt}px`, overflow: "hidden" }}>
          <div
            class="orbfx"
            style={{
              width: "201px",
              height: "201px",
              left: "calc(50% - 100px)",
              top: `${sunTop}px`,
              transition: "top 4s cubic-bezier(.16,.84,.24,1)",
            }}
          />
        </div>
        <div class="horizon" style={{ top: `${horizonAt}px` }} />
        <div class="seafb" style={{ top: `${horizonAt + 1}px` }}>
          {GLINTS.map((g, i) => (
            <i
              key={i}
              style={{
                left: `calc(50% + ${g.offset}px)`,
                top: `${g.top}px`,
                width: `${g.width}px`,
                height: `${g.height}px`,
                "--x": `${g.x}px`,
                "--d": `${g.d}s`,
                "--dl": `${g.dl}s`,
                "--o1": g.o1,
                "--o2": g.o2,
              }}
            />
          ))}
        </div>
    </GlBox>
  );
}
