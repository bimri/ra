export interface Thought{id:string;text:string;basis?:number}
export const DRAFT_AFTER_MS=800,SPEAK_AFTER_MS=2000;
/** Voice the transcriber never opened a thought for (a breath, a bump) is nothing once it has been quiet this long. */
export const NOTHING_AFTER_MS=3000;
/** Quiet is measured from actual incoming voice, independently of ASR/network completion time. */
export class SpeechGate{
  private voiceAt:number|null=null;private timer:ReturnType<typeof setTimeout>|null=null;private nothingTimer:ReturnType<typeof setTimeout>|null=null;
  /** Called when voice turned out to be nothing, so a reply it held back can be said after all. */
  onNothing?:()=>void;private closed=false;
  private latest:Thought|null=null;private confirmed=true;private fresh=false;private revision=0;private offered="";
  private readonly changed=new Set<()=>void>();
  constructor(private readonly draft:(thought:Thought,revision:number)=>void,private readonly now=Date.now){}
  voice(){
    if(this.closed)return;const at=this.now();if(this.voiceAt===null||at-this.voiceAt>=160){this.latest=null;this.confirmed=false;this.fresh=true}
    this.voiceAt=at;this.revision++;this.offered="";clearTimeout(this.timer);this.timer=setTimeout(()=>this.offer(),DRAFT_AFTER_MS);
    clearTimeout(this.nothingTimer);this.nothingTimer=setTimeout(()=>this.heardNothing(),NOTHING_AFTER_MS);this.notify();
  }
  /** The phone heard voice but the transcriber opened no thought for it: without this, the gate stayed shut and Ra silent. */
  private heardNothing(){if(this.closed||!this.fresh)return;this.fresh=false;this.confirmed=true;this.notify();this.onNothing?.()}
  partial(thought:Thought){if(this.closed)return;this.latest={...thought};this.confirmed=false;this.fresh=false;this.revision++;this.offer();this.notify()}
  final(thought:Thought):boolean{
    if(this.closed||this.fresh||this.latest?.id!==thought.id)return false;
    this.latest={...thought};this.confirmed=true;this.revision++;this.offer();this.notify();return true;
  }
  drop(id:string){if(this.latest?.id===id){this.latest=null;this.confirmed=true;this.fresh=false;this.notify()}}
  current(revision:number){return !this.closed&&revision===this.revision}
  private offer(){if(this.closed||this.confirmed||!this.latest?.text.trim()||this.voiceAt===null||this.now()-this.voiceAt<DRAFT_AFTER_MS)return;const key=JSON.stringify(this.latest);if(key===this.offered)return;this.offered=key;this.draft({...this.latest},this.revision)}
  private notify(){for(const change of [...this.changed])change()}
  wait(signal:AbortSignal):Promise<void>{
    return new Promise((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>|null=null;
      const clean=()=>{clearTimeout(timer);this.changed.delete(check);signal.removeEventListener("abort",check)};
      const check=()=>{clearTimeout(timer);if(signal.aborted||this.closed){clean();reject(signal.reason??new DOMException("Listening ended","AbortError"));return}const delay=this.voiceAt===null?0:this.voiceAt+SPEAK_AFTER_MS-this.now();if(delay<=0&&this.confirmed){clean();resolve();return}if(delay>0)timer=setTimeout(check,delay)};
      this.changed.add(check);signal.addEventListener("abort",check,{once:true});check();
    });
  }
  close(){if(this.closed)return;this.closed=true;this.latest=null;clearTimeout(this.timer);clearTimeout(this.nothingTimer);this.notify();this.changed.clear()}
}
