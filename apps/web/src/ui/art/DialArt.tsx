// E6 / E7 · the Dial's flat fallback: a half circle of years, your needle on
// your call, and Ra's range glowing along the rim once you've made it. The
// geometry is the canvas's: centre (171, 150), 30° a year, seven years.

const CX = 171;
const CY = 150;
const YEARS = 7;

const at = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const;
};
const f = (n: number) => n.toFixed(1);

export function DialArt({ start, call, range }: { start: number; call: number | null; range?: [number, number] | null }) {
  const angle = (year: number) => 180 - (year - start) * 30;
  const ticks: preact.JSX.Element[] = [];
  for (let i = 0; i <= (YEARS - 1) * 10; i++) {
    const deg = 180 - i * 3;
    const major = i % 10 === 0;
    const [x1, y1] = at(deg, major ? 114 : 121);
    const [x2, y2] = at(deg, 128);
    ticks.push(<line key={i} x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)} stroke="currentColor" stroke-width={major ? 1.4 : 0.8} opacity={major ? 0.9 : 0.4} />);
  }
  const arc = range && (() => {
    const [x1, y1] = at(angle(range[0]), 136);
    const [x2, y2] = at(angle(range[1]), 136);
    return `M${f(x1)} ${f(y1)}A136 136 0 0 1 ${f(x2)} ${f(y2)}`;
  })();
  const needle = call !== null ? at(angle(call), 88) : null;
  const years = Array.from({ length: YEARS }, (_, i) => start + i);
  const label = `A dial of years from ${start} to ${start + YEARS - 1}${call !== null ? `; your needle points at ${call}` : ""}${range ? `, Ra's range covers ${range[0]} to ${range[1]}` : ""}`;

  return (
    <svg width="100%" viewBox="0 0 342 168" role="img" aria-label={label} style={{ display: "block", color: "var(--text)", overflow: "visible", maxWidth: "342px" }}>
      {arc && (
        <path
          class="draw"
          pathLength={1}
          d={arc}
          fill="none"
          stroke="var(--sig)"
          stroke-width="6"
          stroke-linecap="round"
          opacity=".9"
          style={{ filter: "drop-shadow(0 0 6px color-mix(in srgb,var(--sig) 60%,transparent))" }}
        />
      )}
      {ticks}
      {years.map((y) => {
        const [x, yy] = at(angle(y), 98);
        return (
          <text key={y} x={f(x)} y={f(yy + 4)} text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="currentColor" opacity={y === call ? 1 : 0.55}>
            {y}
          </text>
        );
      })}
      {needle && (
        <g style={{ transformOrigin: `${CX}px ${CY}px`, animation: "uiNeedle 1.8s cubic-bezier(.3,1.5,.5,1) .3s both" }}>
          <line x1={CX} y1={CY} x2={f(needle[0])} y2={f(needle[1])} stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        </g>
      )}
      <circle cx={CX} cy={CY} r="7" fill="currentColor" />
      <circle cx={CX} cy={CY} r="2.5" fill="var(--sig)" />
    </svg>
  );
}
