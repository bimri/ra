import {AUDIO_RATE,FRAME_SAMPLES,type AudioFrame} from "@ra/core";
import {toWords} from "./clip";
import type {Transcriber,TranscriberSession,TranscriptHandlers} from "./types";
export type AsrSocket=Pick<WebSocket,"send"|"close"|"addEventListener">;
type Connect=(signal:AbortSignal)=>Promise<AsrSocket>;
export const ASR_MODEL="muse-voice-transcribe-1.0";
export const MUSE_LANGUAGES:Record<string,string>={en:"English",fr:"French",es:"Spanish",pt:"Portuguese",ar:"Arabic",bn:"Bengali",nl:"Dutch",de:"German",he:"Hebrew",hi:"Hindi",id:"Indonesian",it:"Italian",ja:"Japanese",kn:"Kannada",ko:"Korean",ms:"Malay",zh:"Mandarin Chinese",mr:"Marathi",pl:"Polish",tl:"Tagalog",ta:"Tamil",te:"Telugu",th:"Thai",tr:"Turkish",vi:"Vietnamese"};
const BLOCK=FRAME_SAMPLES*4,WINDOW=AUDIO_RATE*90;
/** Exact PCM retained in a fixed ring; an unavailable interval is an error, never a shortened recording. */
class AudioWindow{
  private readonly pcm=new Int16Array(WINDOW);private through=0;
  get ms(){return this.through/AUDIO_RATE*1000}
  push(pcm:Int16Array){for(const sample of pcm)this.pcm[this.through++%WINDOW]=sample}
  slice(startMs:number,endMs:number){const start=Math.floor(startMs*AUDIO_RATE/1000),end=Math.min(this.through,Math.ceil(endMs*AUDIO_RATE/1000));if(start<Math.max(0,this.through-WINDOW)||end<start)throw new Error("expired audio");return Int16Array.from({length:end-start},(_,i)=>this.pcm[(start+i)%WINDOW]!)}
  clear(){this.pcm.fill(0);this.through=0}
}
export async function connect(signal:AbortSignal):Promise<AsrSocket>{
  const response=await fetch("https://api.meta.ai/v1/asr/realtime",{headers:{Upgrade:"websocket"},signal});
  if(response.status!==101||!response.webSocket)throw new Error("ASR upgrade failed");response.webSocket.accept();return response.webSocket;
}
interface Turn{id:string;start:number;end?:number;text?:string;complete:boolean}
/** Explicit server provider only. No retry/replay of live audio and no fallback to fake transcription. */
export class MuseTranscriber implements Transcriber{
  readonly name="muse-voice-transcribe (approximate word timing)";readonly stub=false;
  constructor(private readonly key:()=>Promise<string|null>,private readonly language="auto",private readonly dial:Connect=connect){}
  open(handlers:TranscriptHandlers,makeId:()=>string):TranscriberSession{
    const controller=new AbortController(),audio=new AudioWindow(),queue:Int16Array[]=[],turns=new Map<number,Turn>(),completed=new Set<number>();
    let ws:AsrSocket|null=null,active:number|null=null,ack=false,closing=false,ended=false,stopped=false,processed=0;
    let pulse:ReturnType<typeof setInterval>|null=null,deadline:ReturnType<typeof setTimeout>|null=null;
    const clean=()=>{if(stopped)return;stopped=true;controller.abort();clearInterval(pulse);clearTimeout(deadline);for(const pcm of queue)pcm.fill(0);queue.length=0;audio.clear();for(const turn of turns.values())handlers.drop?.(turn.id);turns.clear();completed.clear();try{ws?.close(1000)}catch{};ws=null};
    const fail=(message="Live transcription was interrupted. Start listening again; no audio will be replayed automatically.")=>{if(stopped)return;handlers.error?.(message);clean()};
    const flush=()=>{
      for(;;){const first=turns.entries().next().value as [number,Turn]|undefined;if(!first||!first[1].complete)return;const [turnId,turn]=first;const end=turn.end??turn.start;
        let pcm:Int16Array;try{pcm=audio.slice(turn.start,end)}catch{fail("This live thought is too long to retain completely. Try shorter thoughts; no recording was shortened.");return}
        turns.delete(turnId);completed.add(turnId);if(completed.size>4096){pcm.fill(0);fail();return}
        const text=turn.text??"",words=toWords({text},pcm).map(word=>({...word,approximate:true as const}));
        if(!words.length){pcm.fill(0);handlers.drop?.(turn.id)}else try{handlers.final(turn.id,words,text,{startMs:turn.start,endMs:end,pcm,respond:turns.size===0})}finally{pcm.fill(0)};
      }
    };
    const tick=()=>{
      if(!ws||!ack||stopped||ended)return;
      if(audio.ms-processed>5_000){fail("Live transcription stopped acknowledging audio. Pause and resume to try again; no queued audio will be replayed.");return}
      if(((ws as unknown as {bufferedAmount?:number}).bufferedAmount??0)>64*1024){fail();return}
      if(closing&&!queue.length){ended=true;clearInterval(pulse);try{ws.send(JSON.stringify({type:"endStream"}))}catch{fail();return}clearTimeout(deadline);deadline=setTimeout(()=>fail(),30_000);return}
      const pcm=new Int16Array(BLOCK);for(let i=0;i<4;i++){const frame=queue.shift();if(frame){pcm.set(frame,i*FRAME_SAMPLES);frame.fill(0)}}
      const bytes=new ArrayBuffer(pcm.byteLength),view=new DataView(bytes);for(let i=0;i<pcm.length;i++)view.setInt16(i*2,pcm[i]!,true);
      try{ws.send(bytes);audio.push(pcm)}catch{fail()}finally{pcm.fill(0);new Uint8Array(bytes).fill(0)}
    };
    const receive=(event:MessageEvent)=>{
      if(stopped)return;if(typeof event.data!=="string"||event.data.length>64_000){fail();return}
      let value:Record<string,unknown>;try{value=JSON.parse(event.data) as Record<string,unknown>;if(!value||typeof value!=="object"||Array.isArray(value))throw new Error()}catch{fail();return}
      if(value.type==="error"){fail();return} // never echo provider bodies or credentials
      if(!ack){if(typeof value.sessionId!=="string"||!value.sessionId||value.type!==undefined){fail();return}ack=true;clearTimeout(deadline);pulse=setInterval(tick,80);return}
      if(!["speechStart","speechEnd","speechComplete","transcript","audioProgress"].includes(String(value.type)))return;
      const at=value.audioProcessedMs;if(typeof at!=="number"||!Number.isSafeInteger(at)||at<0||at>audio.ms+80){fail();return}
      processed=Math.max(processed,Math.min(at,audio.ms));if(value.type==="audioProgress")return;
      if(value.type==="transcript"){
        if(typeof value.transcript!=="string"||value.transcript.length>16_000){fail();return}
        const turn=active===null?undefined:turns.get(active);if(!turn)return;
        let pcm:Int16Array;try{pcm=audio.slice(turn.start,Math.min(audio.ms,at))}catch{fail();return}
        try{handlers.partial(turn.id,toWords({text:value.transcript},pcm).map(word=>({...word,approximate:true as const})))}finally{pcm.fill(0)}return;
      }
      const id=value.turnId;if(typeof id!=="number"||!Number.isInteger(id)||id<-(2**31)||id>=2**31){fail();return}if(completed.has(id))return;
      if(value.type==="speechStart"){
        if(turns.has(id))return;if(turns.size>=8){fail();return}
        const turn={id:makeId(),start:Math.max(0,Math.min(at,audio.ms)-200),complete:false};turns.set(id,turn);active=id;handlers.partial(turn.id,[]);return;
      }
      const turn=turns.get(id);if(!turn){fail();return}const end=Math.min(at,audio.ms);if(end<turn.start){fail();return}
      if(value.type==="speechEnd"){turn.end=end;return}
      if(typeof value.transcript!=="string"||value.transcript.length>16_000){fail();return}
      turn.text=value.transcript;turn.end??=end;turn.complete=true;if(active===id)active=null;flush();
    };
    deadline=setTimeout(()=>fail("Live transcription could not connect. Start listening again when it is available."),10_000);
    void (async()=>{
      if(this.language!=="auto"&&!MUSE_LANGUAGES[this.language]){fail("This language is unavailable for live transcription. Choose a supported language before listening.");return}
      const key=await this.key();if(stopped)return;if(!key){fail("Live transcription is selected but its key is unavailable.");return}
      const socket=await this.dial(controller.signal);if(stopped){socket.close(1000);return}ws=socket;
      ws.addEventListener("message",receive);ws.addEventListener("error",()=>fail());ws.addEventListener("close",event=>{if(stopped)return;if(!ended||event.code!==1000||turns.size)fail();else clean()});
      ws.send(JSON.stringify({authorization:{accessToken:"Bearer "+key},audioEncoding:"PCM_16KHZ",model:ASR_MODEL,mode:"ENDPOINTING",partialMode:"CUMULATIVE",emitAudioProgress:true,...(this.language!=="auto"?{languageBias:[MUSE_LANGUAGES[this.language]]}:{})}));
    })().catch(()=>fail());
    return {push(frame:AudioFrame){if(stopped||closing)return;if(frame.pcm.length!==FRAME_SAMPLES||queue.length>=100){fail("Live audio could not keep up. Start listening again; queued audio will not be replayed.");return}queue.push(frame.pcm.slice())},close(){if(stopped||closing)return;closing=true},cancel:clean};
  }
}
