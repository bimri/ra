// Runs on the audio thread. Takes the mic at the device's rate, averages it
// down to 16 kHz mono, and posts one 20 ms frame (320 samples) at a time
// with its loudness. Prosody beyond loudness (pitch, pace) joins here later.

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const OUT_RATE = 16_000;
const FRAME = 320;

class Capture extends AudioWorkletProcessor {
  private readonly step = sampleRate / OUT_RATE;
  private phase = 0;
  private sum = 0;
  private count = 0;
  private frame = new Int16Array(FRAME);
  private filled = 0;
  private energy = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i] ?? 0;
      this.count += 1;
      this.phase += 1;
      if (this.phase < this.step) continue;
      this.phase -= this.step;
      const s = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.energy += s * s;
      this.frame[this.filled++] = Math.round(s * 32767);
      if (this.filled === FRAME) {
        const level = Math.sqrt(this.energy / FRAME);
        this.port.postMessage({ pcm: this.frame, level }, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME);
        this.filled = 0;
        this.energy = 0;
      }
    }
    return true;
  }
}

registerProcessor("ra-capture", Capture);
