// I3 · The Watch keeps the night's moon: "Waxing crescent · 35%". Computed
// from a known new moon and the synodic month; close enough for the sky.

const SYNODIC_DAYS = 29.530588853;
/** A new moon: 6 Jan 2000, 18:14 UTC. */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

const NAMES = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];

export interface Moon {
  name: string;
  /** Lit fraction of the disc, 0..1. */
  lit: number;
  waxing: boolean;
  /** How far through the month, 0..1 from new moon (the sky scene's "phase"). */
  turn: number;
}

export function moonAt(at: number): Moon {
  const days = (at - NEW_MOON) / 86_400_000;
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
  const turn = age / SYNODIC_DAYS;
  return {
    name: NAMES[Math.round(turn * 8) % 8]!,
    lit: (1 - Math.cos(2 * Math.PI * turn)) / 2,
    waxing: turn < 0.5,
    turn,
  };
}

/**
 * The lit part of a moon of radius r at (cx, cy), as an SVG path: the bright
 * limb, then the terminator (an ellipse) back to the top. Waxing is lit on
 * the right, as seen from the north.
 */
export function moonPath(m: Pick<Moon, "lit" | "waxing">, cx: number, cy: number, r: number): string {
  const rx = r * Math.abs(1 - 2 * m.lit);
  const limb = m.waxing ? 1 : 0;
  // A crescent's terminator bows towards the lit limb; a gibbous one away from it.
  const term = m.lit < 0.5 ? 1 - limb : limb;
  const top = `${cx} ${cy - r}`;
  const bottom = `${cx} ${cy + r}`;
  return `M${top}A${r} ${r} 0 0 ${limb} ${bottom}A${rx.toFixed(2)} ${r} 0 0 ${term} ${top}Z`;
}
