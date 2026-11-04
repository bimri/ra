/**
 * Barge-in while Ra speaks. Echo cancellation removes most of Ra's own voice
 * from the mic, but not all of it (an emulator's mic, or a phone on speaker,
 * hears the room). So this learns the leftover echo while Ra talks, and you
 * cut in only when you're clearly louder than that echo for a quarter of a
 * second. The first 200 ms of each line only teach it the echo. It runs on
 * the phone, so Ra stops without waiting for the network.
 */
export class BargeIn {
  private run = 0;
  private seen = 0;
  /** Recent echo peak at the mic; decays so one loud moment doesn't raise the bar for long. */
  private echo = 0;

  constructor(
    private readonly level = 0.06,
    private readonly holdFrames = 12,
    private readonly warmupFrames = 10,
    private readonly overEcho = 1.6,
  ) {}

  /** Feed one 20 ms frame while Ra is speaking; true the moment you cut in. */
  push(level: number): boolean {
    if (++this.seen <= this.warmupFrames) {
      this.echo = Math.max(this.echo, level);
      return false;
    }
    if (level >= Math.max(this.level, this.echo * this.overEcho)) this.run++;
    else {
      this.run = 0;
      this.echo = Math.max(this.echo * 0.98, level);
    }
    if (this.run < this.holdFrames) return false;
    this.run = 0;
    return true;
  }

  reset(): void {
    this.run = 0;
    this.seen = 0;
    this.echo = 0;
  }
}

/**
 * A small pause detector, measured against the room rather than a fixed
 * level: it keeps a running noise floor that drops quickly in quiet and rises
 * slowly in steady sound, so a fan, traffic or an emulator's always-on mic
 * becomes the new quiet within a few seconds. A hangover keeps a breath
 * between words from counting as a pause. The real detector (in-browser
 * model, 0.8 s "maybe done" and 2 s "done") lands with the voice loop.
 */
export class PauseDetector {
  private quietMs = 0;
  private floor: number;
  /** How long the level has held steady (within 8% frame to frame): a hum, a fan, an emulator's test tone. */
  private steadyMs = 0;
  private last = 0;
  speaking = false;

  constructor(
    /** Below this level nothing counts as speech, however quiet the room. */
    private readonly minLevel = 0.012,
    /** Speech must stand this far above the noise floor. */
    private readonly ratio = 3,
    private readonly hangoverMs = 300,
    initialFloor = 0.004,
  ) {
    this.floor = initialFloor;
  }

  get noiseFloor(): number {
    return this.floor;
  }

  push(level: number, frameMs = 20): boolean {
    // Speech jumps from frame to frame; a steady sound doesn't. Half a second of steadiness and the
    // floor rises to meet it fast, so constant sound is quiet within about a second, not four.
    this.steadyMs = Math.abs(level - this.last) <= 0.08 * Math.max(level, 1e-4) ? this.steadyMs + frameMs : 0;
    this.last = level;
    const rate = level < this.floor ? 0.2 : this.steadyMs >= 500 ? 0.1 : 0.002;
    this.floor += (level - this.floor) * rate;
    if (level >= Math.max(this.minLevel, this.floor * this.ratio)) {
      this.quietMs = 0;
      this.speaking = true;
    } else {
      this.quietMs += frameMs;
      if (this.quietMs >= this.hangoverMs) this.speaking = false;
    }
    return this.speaking;
  }
}
