// U3's Rings card: one hand-drawn growth ring per month, wider when you had
// more Rays that month, and the landfall month's ring in the signal colour.
// Rings share one wobble, so each grows out of the one inside it, like wood.

const SIZE = 98;
const CX = 52;
const CY = 48;
const POINTS = 120;

/** A small fixed wobble: same shape every render, different per person only through the widths. */
function wobble(a: number, ring: number): number {
  return 0.07 * Math.sin(3 * a + 0.6) + 0.045 * Math.sin(5 * a + 2.1 + ring * 0.35) + 0.03 * Math.sin(2 * a + 4.2 - ring * 0.2);
}

function ringPath(r: number, ring: number): string {
  let d = "";
  for (let i = 0; i <= POINTS; i++) {
    const a = (i / POINTS) * Math.PI * 2;
    const rr = r * (1 + wobble(a, ring));
    d += `${i ? "L" : "M"}${(CX + rr * Math.cos(a)).toFixed(1)} ${(CY + rr * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

export function GrowthRings({ counts, landfall = -1, label }: { counts: number[]; landfall?: number; label: string }) {
  const most = Math.max(1, ...counts);
  const widths = counts.map((n) => 0.4 + 0.6 * (n / most));
  const scale = 35 / Math.max(1, widths.reduce((a, b) => a + b, 0));
  let r = 8;
  const rings = widths.map((w, i) => {
    r += w * scale;
    return { d: ringPath(r, i), i };
  });
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label} style={{ display: "block", color: "var(--text)", overflow: "visible" }}>
      {rings.map(({ d, i }) =>
        i === landfall ? (
          <g key={i}>
            <path d={d} fill="none" stroke="var(--sig)" stroke-width="7" opacity=".14" />
            <path class="draw" pathLength={1} d={d} fill="none" stroke="var(--sig)" stroke-width="1.8" style={{ animationDelay: `${(i * 0.09).toFixed(2)}s` }} />
          </g>
        ) : (
          <path key={i} class="draw" pathLength={1} d={d} fill="none" stroke="currentColor" stroke-width="0.8" opacity={(0.45 + 0.25 * (counts[i]! / most)).toFixed(2)} style={{ animationDelay: `${(i * 0.09).toFixed(2)}s` }} />
        ),
      )}
      <circle cx={CX} cy={CY} r="2" fill="var(--sig)" />
    </svg>
  );
}
