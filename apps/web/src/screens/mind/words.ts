import type { Views } from "@ra/core";

// I2's small pure parts: where a quote was said, and which part of a claim
// takes the accent.

const ORDINAL = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Where a quote was said: "Ray two · 04:42" (time into the Ray), or "Capture · 28 Oct". */
export function whereSaid(v: Views, said: { rayId: string | null; startMs: number; at: number }): string {
  const rays = Object.values(v.rays).sort((a, b) => a.startedAt - b.startedAt);
  const n = said.rayId ? rays.findIndex((r) => r.rayId === said.rayId) : -1;
  if (n < 0) return `Capture · ${new Date(said.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  const s = Math.max(0, Math.floor(said.startMs / 1000));
  return `Ray ${ORDINAL[n] ?? n + 1} · ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The claim's last clause takes the accent, as on the board ("…when you're fixing *what keeps the power running.*"). */
export function accentTail(claim: string): [string, string] {
  const m = /^(.{12,})(,\s*|\s+(?=(?:what|why|when|because|so|and)\s))([^,]{8,})$/i.exec(claim);
  return m ? [`${m[1]}${m[2]}`, m[3]!] : [claim, ""];
}
