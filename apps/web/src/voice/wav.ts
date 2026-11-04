import { AUDIO_RATE } from "@ra/core";

/** 16 kHz mono PCM as a WAV file, the same format the Ray's transcriber reads. */
export function wav(chunks: Int16Array[]): Blob {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ascii = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, AUDIO_RATE, true);
  v.setUint32(28, AUDIO_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, n * 2, true);
  let at = 44;
  for (const c of chunks) for (const s of c) (v.setInt16(at, s, true), (at += 2));
  const result=new Blob([buf], { type: "audio/wav" });
  new Uint8Array(buf).fill(0);
  return result;
}
