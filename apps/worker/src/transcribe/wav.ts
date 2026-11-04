import { AUDIO_RATE } from "@ra/core";

/** 16 kHz mono 16-bit PCM as a WAV file. */
export function wav(pcm: Int16Array, rate = AUDIO_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i] ?? 0, true);
  return out;
}

export function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** The 16-bit samples of a WAV file (its "data" chunk), or null if it isn't one. */
export function pcmOf(file: Uint8Array): Int16Array | null {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const tag = (at: number) => String.fromCharCode(...file.subarray(at, at + 4));
  if (file.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  for (let at = 12; at + 8 <= file.length; ) {
    const size = v.getUint32(at + 4, true);
    if (tag(at) === "data") {
      const n = Math.floor(Math.min(size, file.length - at - 8) / 2);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = v.getInt16(at + 8 + i * 2, true);
      return out;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}
