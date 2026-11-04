import { RA_AUDIO_RATE } from "@ra/core";

/**
 * Plays Ra's voice as it streams in: each 40 ms frame is queued right after
 * the one before, so playback starts with the first frame. Stopping is
 * immediate and local, which is what makes barge-in feel instant.
 */
export class RaPlayer {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  /** Ra's loudness as it plays, for B4's bars. */
  private readonly meter: AnalyserNode;
  private readonly samples = new Float32Array(512);
  /** B4 "Say it again": the line Ra is saying, kept until the next one starts (capped at a minute). */
  private line: Int16Array[] = [];
  private lineSamples = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private nextAt = 0;
  /** A little headroom so network jitter doesn't leave gaps. */
  private readonly leadS = 0.12;
  /**
   * Frames that arrive faster than they play (a whole line can arrive in one burst) are merged
   * into larger buffers: hundreds of 40 ms sources crackle on slow phones. Playback starts at once.
   */
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // At Ra's own rate, back-to-back buffers join seamlessly; the device converts once at its output.
    // At the device rate (often 48 kHz) each buffer is resampled on its own and the joins click.
    this.ctx = new AudioContext({ sampleRate: RA_AUDIO_RATE });
    this.out = this.ctx.createGain();
    this.meter = this.ctx.createAnalyser();
    this.meter.fftSize = 512;
    this.out.connect(this.meter);
    this.out.connect(this.ctx.destination);
  }

  /** A new line from Ra: what "Say it again" replays from now on. */
  beginLine(): void {
    for (const pcm of this.line) pcm.fill(0);
    this.line = [];
    this.lineSamples = 0;
  }

  /** B4 "Say it again": Ra's last line, from the start. */
  replay(): void {
    if (!this.line.length) return;
    this.stop();
    const copy = this.line.map((pcm) => pcm.slice());
    this.keepLine = false;
    for (const pcm of copy) this.push(pcm);
    this.keepLine = true;
  }

  get canReplay(): boolean {
    return this.line.length > 0;
  }

  /** 0..1, how loud Ra is right now. */
  level(): number {
    this.meter.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const v of this.samples) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  }

  private keepLine = true;

  /** Call from a tap: browsers only let audio start after a gesture. */
  async unlock(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  get playing(): boolean {
    return this.pendingSamples > 0 || (this.sources.size > 0 && this.nextAt > this.ctx.currentTime);
  }

  push(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    if (this.keepLine && this.lineSamples < RA_AUDIO_RATE * 60) {
      this.line.push(pcm.slice());
      this.lineSamples += pcm.length;
    }
    this.pending.push(pcm.slice());
    this.pendingSamples += pcm.length;
    // Little queued ahead: play now. Otherwise gather for a moment and schedule one larger buffer.
    if (this.nextAt - this.ctx.currentTime < 0.25) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), 60);
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pendingSamples) return;
    const buf = this.ctx.createBuffer(1, this.pendingSamples, RA_AUDIO_RATE);
    const ch = buf.getChannelData(0);
    let at = 0;
    for (const pcm of this.pending) {
      for (let i = 0; i < pcm.length; i++) ch[at + i] = (pcm[i] ?? 0) / 32768;
      at += pcm.length;
      pcm.fill(0);
    }
    this.pending = [];
    this.pendingSamples = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    const now = this.ctx.currentTime;
    if (this.nextAt < now + 0.01) this.nextAt = now + this.leadS;
    src.start(this.nextAt);
    this.nextAt += buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.nextAt = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const pcm of this.pending) pcm.fill(0);
    this.pending = [];
    this.pendingSamples = 0;
  }

  close(): void {
    this.stop();
    this.beginLine();
    void this.ctx.close();
  }
}
