// A4 · "This is the only sound Ra makes." The listening tone: a soft rising
// fifth, about a second long, played when Ra starts listening. No chimes, no
// alerts, no badges. Synthesised here, so it ships as no file at all.

let ctx: AudioContext | null = null;

export function playListeningTone(): void {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.12, now + 0.06);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
    out.connect(ctx.destination);
    for (const [freq, at] of [
      [440, 0],
      [659.25, 0.12],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + at);
      osc.connect(out);
      osc.start(now + at);
      osc.stop(now + 1.05);
    }
  } catch {
    // No audio: the tone is a courtesy, never required.
  }
}
