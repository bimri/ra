// E1's route: from you, through the next island, to what's after it, then your star.
// Same curve and marks as the board; the names come from your island.

export function RouteLine({ you, island, after }: { you: string; island: string; after: string }) {
  const label = `Your route: from you, to the next island, ${island}, then ${after}, then your star`;
  return (
    <svg width="100%" viewBox="0 0 350 128" role="img" aria-label={label} style={{ display: "block", color: "var(--text)", overflow: "visible", marginTop: "16px", flex: "none" }}>
      <path d="M16 82C70 82 70 58 124 58C180 58 180 48 236 48C284 48 284 24 332 24" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 5" opacity=".45" />
      <path d="M16 82C70 82 70 58 124 58" fill="none" stroke="var(--sig)" stroke-width="2.4" stroke-linecap="round" />
      <path class="comet" pathLength={1} d="M16 82C70 82 70 58 124 58C180 58 180 48 236 48C284 48 284 24 332 24" fill="none" stroke="var(--sig)" stroke-width="3" stroke-linecap="round" style={{ filter: "drop-shadow(0 0 4px var(--sig))" }} />
      <circle cx="16" cy="82" r="6" fill="currentColor" />
      <circle class="halo" cx="124" cy="58" r="10" fill="none" stroke="var(--sig)" stroke-width="1.2" />
      <circle cx="124" cy="58" r="9" fill="var(--sig)" style={{ filter: "drop-shadow(0 0 8px var(--sig))" }} />
      <circle cx="236" cy="48" r="6" fill="var(--bg)" stroke="currentColor" stroke-width="1.4" opacity=".7" />
      <g transform="translate(332 24)">
        <g class="tw">
          <path d="M0 -14C.5 -3.5 3.5 -.5 14 0C3.5 .5 .5 3.5 0 14C-.5 3.5 -3.5 .5 -14 0C-3.5 -.5 -.5 -3.5 0 -14Z" fill="var(--sig)" />
          <circle r="2.5" fill="#FFF3E6" />
        </g>
      </g>
      <Name x={16} y={108} anchor="start" name="You" sub={you || "today"} />
      <Name x={124} y={84} anchor="middle" name={island} sub="next island" />
      <Name x={236} y={74} anchor="middle" name={after} sub="later" />
      <Name x={332} y={54} anchor="end" name="Star" sub="yours" />
    </svg>
  );
}

function Name({ x, y, anchor, name, sub }: { x: number; y: number; anchor: "start" | "middle" | "end"; name: string; sub: string }) {
  return (
    <>
      <text x={x} y={y} text-anchor={anchor} font-family="Inter Tight" font-weight="500" font-size="13" fill="currentColor">
        {name.length > 22 ? `${name.slice(0, 21)}…` : name}
      </text>
      <text x={x} y={y + 14} text-anchor={anchor} font-family="Inter Tight" font-size="11" fill="currentColor" opacity=".55">
        {sub}
      </text>
    </>
  );
}
