export type RecordingSlot="then"|"now";
/** Late play promises/events never restart audio after stop, navigation or lock. */
export class RecordingSequence{
  private slots:{then:HTMLAudioElement|null;now:HTMLAudioElement|null}={then:null,now:null};
  private epoch=0;private closed=false;private running=false;private remove:(()=>void)[]=[];
  constructor(private readonly callbacks:{stage(value:RecordingSlot|null):void;problem(value:string|null):void}){}
  attach(slot:RecordingSlot,audio:HTMLAudioElement|null){if(this.slots[slot]===audio)return;this.stop();this.slots[slot]=audio;if(this.closed)audio?.pause()}
  stop(){this.epoch++;this.running=false;this.remove.splice(0).forEach(remove=>remove());for(const audio of Object.values(this.slots))try{audio?.pause()}catch{}if(!this.closed)this.callbacks.stage(null)}
  close(){this.closed=true;this.stop();this.slots={then:null,now:null}}
  play(){
    const a=this.slots.then,b=this.slots.now;if(this.closed||this.running||!a||!b)return;
    this.stop();const epoch=this.epoch;this.running=true;this.callbacks.problem(null);
    let position:RecordingSlot|null=null;
    const current=()=>!this.closed&&this.running&&epoch===this.epoch&&this.slots.then===a&&this.slots.now===b;
    const failed=()=>{if(!current())return;this.stop();this.callbacks.problem("Your voice could not play. Try again.")};
    const listen=(audio:HTMLAudioElement,event:string,handler:()=>void)=>{audio.addEventListener(event,handler);this.remove.push(()=>audio.removeEventListener(event,handler))};
    const play=(audio:HTMLAudioElement,slot:RecordingSlot)=>{if(!current()||position===slot)return;position=slot;this.callbacks.stage(slot);try{void audio.play().then(()=>{if(!current())audio.pause()},failed)}catch{failed()}};
    try{a.currentTime=0;b.currentTime=0;listen(a,"ended",()=>{if(position==="then")play(b,"now")});listen(b,"ended",()=>{if(current()&&position==="now")this.stop()});listen(a,"error",()=>{if(position==="then")failed()});listen(b,"error",()=>{if(position==="now")failed()});play(a,"then")}catch{failed()}
  }
}
