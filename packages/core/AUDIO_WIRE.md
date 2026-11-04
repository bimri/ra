# Live audio transport v1

Phone `hello.audio` advertises `pcm16-predict-v1`. Worker `ready.audio` confirms it; otherwise both directions use the existing four-byte header plus little-endian PCM16. Reconnection negotiates again. No additional codec runtime is packaged.

Compressed packets use this layout:

| Offset | Bytes | Value |
| --- | --- | --- |
| 0 | 4 | ASCII `RAP1` |
| 4 | 4 | Original kind, speaking flag and uint16 loudness header |
| 8 | 4 | Little-endian sample count, 8–16384 |
| 12 | 4 | IEEE CRC32 of the complete legacy frame |
| 16 | 4 | First two signed little-endian PCM16 samples |
| 20 | variable | Predictor residuals and zero runs |

Predict each following sample as `2 × previous − before`, wrapping to signed16. Wrap its residual to signed16, zigzag encode it, and write canonical unsigned LEB128. A zero value instead introduces a canonical LEB128 run length; reconstruct each predicted sample in that run. Integers use at most three bytes and never exceed65535. Runs must be positive and fit the remaining samples. Reject extra input, invalid headers, oversized counts and CRC mismatches before delivery. Mic frames must still contain exactly320 samples.

Send a compressed packet only when smaller than its legacy equivalent. Silence and smooth signals compress; noisy frames may use legacy PCM. This preserves every sample and keeps existing stored WAV formats unchanged. The codec is synchronous, so it introduces no batching delay or asynchronous frame reordering.

Tests include an independently computed packet/CRC reference, predictor wraparound, noise/smooth signals, malformed input, negotiation and reconnect behavior. Real isolated Worker acceptance produced matching synthetic transcripts, with80500 raw versus26500 compressed bytes. This is not a real-speech compression or latency benchmark.
