// The shape of a kept line of your voice, for G2 and G3: loudness in equal slices.

/** Loudness in BARS slices, 0..1, from the decoded clip. */
export async function bars(bytes: ArrayBuffer, BARS = 56): Promise<number[]> {
  const ctx = new OfflineAudioContext(1, 1, 16_000);
  const audio = await ctx.decodeAudioData(bytes.slice(0));
  const data = audio.getChannelData(0);
  const size = Math.floor(data.length / BARS) || 1;
  const out = Array.from({ length: BARS }, (_, i) => {
    let sum = 0;
    for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j++) sum += data[j]! * data[j]!;
    return Math.sqrt(sum / size);
  });
  const max = Math.max(...out, 1e-6);
  return out.map((v) => v / max);
}
