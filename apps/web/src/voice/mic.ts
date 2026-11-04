import captureUrl from "./capture.worklet.ts?worker&url";
import { PauseDetector } from "./pause";

export interface MicFrame {
  /** 20 ms of 16 kHz mono PCM */
  pcm: Int16Array;
  /** RMS level, 0..1 */
  level: number;
  /** The pause detector's call for this frame */
  speaking: boolean;
}

export interface Mic {
  stop(): void;
  /** Back in front: a phone may suspend the audio context while the app is hidden. */
  resume(): void;
  /** The track is still live (a call or a revoked permission ends it). */
  alive(): boolean;
}

export async function openMic(onFrame: (f: MicFrame) => void,signal?:AbortSignal): Promise<Mic> {
  const aborted=()=>new DOMException("Recording cancelled.","AbortError");
  if(signal?.aborted)throw aborted();
  let stopped=false;let stream:MediaStream|undefined;let ctx:AudioContext|undefined;
  let source:MediaStreamAudioSourceNode|undefined;let node:AudioWorkletNode|undefined;let closing=false;
  const stop=()=>{
    if(stopped)return;
    stopped=true;signal?.removeEventListener("abort",stop);
    if(node){node.port.onmessage=null;try{node.disconnect()}catch{/* already disconnected */}}
    try{source?.disconnect()}catch{/* already disconnected */}
    stream?.getTracks().forEach(track=>track.stop());
    if(ctx&&!closing){closing=true;void ctx.close().catch(()=>{})}
  };
  signal?.addEventListener("abort",stop,{once:true});
  const check=()=>{if(stopped||signal?.aborted)throw aborted()};
  try {
  const received = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  if(stopped||signal?.aborted){received.getTracks().forEach(track=>track.stop());throw aborted()}
  stream=received;ctx=new AudioContext();
  await ctx.audioWorklet.addModule(captureUrl);check();
  source = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, "ra-capture", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
  const vad = new PauseDetector();
  node.port.onmessage = (e: MessageEvent<{ pcm: Int16Array; level: number }>) => {
    if(stopped||signal?.aborted){e.data.pcm.fill(0);return}
    onFrame({ pcm: e.data.pcm, level: e.data.level, speaking: vad.push(e.data.level) });
  };
  source.connect(node);
  if (ctx.state === "suspended") await ctx.resume();
  check();
  const live=stream;const audio=ctx;
  return {stop,resume:()=>{if(audio.state==="suspended")void audio.resume().catch(()=>{})},alive:()=>!stopped&&live.getAudioTracks().some(track=>track.readyState==="live")};
  }catch(error){stop();throw error}
}
