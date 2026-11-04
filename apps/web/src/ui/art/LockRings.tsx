// A3 / J3 · the lock as the boards draw it flat: nine broken hairline rings
// around the signal core, each turning slowly, alternate ones the other way.
// The flat fallback under the lock scene, so the first frame already matches.

const RINGS = [
  "M112.5 96.2A14 14 0 1 1 107.5 96.2",
  "M124.8 92.4A23 23 0 1 1 112.3 87.1",
  "M140.1 99.0A32 32 0 1 1 121.9 80.3",
  "M150.6 104.7A41 41 0 1 1 143.6 86.5",
  "M156.3 129.0A50 50 0 1 1 157.3 93.8",
  "M158.4 143.8A59 59 0 1 1 167.2 124.6",
  "M139.1 171.5A68 68 0 1 1 168.7 144.3",
  "M104.0 186.8A77 77 0 1 1 163.1 165.7",
  "M84.7 192.2A86 86 0 1 1 125.5 194.6",
];

export function LockRings({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" aria-hidden="true" style={{ display: "block", color: "var(--text)" }}>
      {RINGS.map((d, i) => (
        <path
          key={d}
          class="spin"
          d={d}
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          opacity={0.35 + i * 0.06}
          style={{ transformOrigin: "110px 110px", animationDuration: `${30 + i * 9}s`, animationDirection: i % 2 ? "reverse" : "normal" }}
        />
      ))}
      <circle cx="110" cy="110" r="18" fill="var(--sig)" opacity=".12" />
      <circle cx="110" cy="110" r="6" fill="var(--sig)" />
    </svg>
  );
}
