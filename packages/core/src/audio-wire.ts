import {decodeAudioFrame,encodeAudioFrame,FRAME_MIC,FRAME_RA,type AudioFrame} from "./socket";

export const AUDIO_CODEC="pcm16-predict-v1" as const;
const MAX_SAMPLES=16_384;
const MAGIC=[82,65,80,49]; // RAP1: versioned lossless linear prediction + zero-run/unsigned LEB128.
const crcTable=Uint32Array.from({length:256},(_,value)=>{let c=value;for(let bit=0;bit<8;bit++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0});
function crc32(bytes:Uint8Array):number {let c=0xffffffff;for(const byte of bytes)c=crcTable[(c^byte)&255]!^(c>>>8);return (c^0xffffffff)>>>0}
const signed16=(n:number)=>(n<<16)>>16;

/** Synchronous and lossless: preserves 20/40 ms frame ordering and falls back if larger. */
export function encodeWireAudio(frame:AudioFrame,compressed=false):ArrayBuffer {
  const raw=encodeAudioFrame(frame);const samples=frame.pcm;
  if(!compressed||samples.length<8||samples.length>MAX_SAMPLES)return raw;
  const bytes=new Uint8Array(samples.length*3+20);const view=new DataView(bytes.buffer);let at=20;
  function variable(value:number){do{const part=value&127;value>>>=7;bytes[at++]=part|(value?128:0)}while(value)}
  try {
    bytes.set(MAGIC);bytes.set(new Uint8Array(raw,0,4),4);view.setUint32(8,samples.length,true);
    view.setInt16(16,samples[0]!,true);view.setInt16(18,samples[1]!,true);
    let previous=samples[1]!;let before=samples[0]!;let i=2;
    while(i<samples.length) {
      const predicted=signed16(2*previous-before);const residual=signed16(samples[i]!-predicted);
      if(residual===0) {
        let run=0;
        do{const current=samples[i]!;before=previous;previous=current;run++;i++}while(i<samples.length&&signed16(samples[i]!-signed16(2*previous-before))===0);
        bytes[at++]=0;variable(run);
      }else {variable((residual<<1)^(residual>>31));before=previous;previous=samples[i++]!}
    }
    if(at>=raw.byteLength)return raw;
    view.setUint32(12,crc32(new Uint8Array(raw)),true);const result=bytes.slice(0,at).buffer;new Uint8Array(raw).fill(0);return result;
  }finally{bytes.fill(0)}
}

function validHeader(kind:number,flags:number){return (kind===FRAME_MIC||kind===FRAME_RA)&&(flags&~1)===0}
/** Length/CRC/canonical integer checks bound hostile inputs before allocation or playback. */
export function decodeWireAudio(buffer:ArrayBuffer,compressed=false):AudioFrame|null {
  if(buffer.byteLength<4||buffer.byteLength>4+MAX_SAMPLES*2)return null;
  const bytes=new Uint8Array(buffer);const view=new DataView(buffer);
  const packed=MAGIC.every((n,i)=>bytes[i]===n);
  if(!packed) {
    if(!validHeader(bytes[0]!,bytes[1]!)||buffer.byteLength<=4)return null;
    return decodeAudioFrame(buffer);
  }
  if(!compressed||bytes.length<22||!validHeader(bytes[4]!,bytes[5]!))return null;
  const count=view.getUint32(8,true);if(count<8||count>MAX_SAMPLES||bytes.length>=4+count*2)return null;
  const pcm=new Int16Array(count);const raw=new Uint8Array(4+count*2);raw.set(bytes.subarray(4,8));const rawView=new DataView(raw.buffer);
  let at=20;let accepted=false;
  function variable():number {
    let value=0;
    for(let index=0;index<3;index++) {
      if(at>=bytes.length)throw new Error("short audio integer");const byte=bytes[at++]!;value|=(byte&127)<<(7*index);
      if(!(byte&128)){if(index>0&&byte===0||value>65535)throw new Error("invalid audio integer");return value}
    }
    throw new Error("invalid audio integer");
  }
  try {
    pcm[0]=view.getInt16(16,true);pcm[1]=view.getInt16(18,true);let i=2;
    while(i<count) {
      const value=variable();
      if(value===0) {
        const run=variable();if(run===0||run>count-i)return null;
        for(let n=0;n<run;n++){pcm[i]=signed16(2*pcm[i-1]!-pcm[i-2]!);i++}
      }else {const residual=(value>>>1)^-(value&1);pcm[i]=signed16(2*pcm[i-1]!-pcm[i-2]!+residual);i++}
    }
    if(at!==bytes.length)return null;
    for(let i=0;i<count;i++)rawView.setInt16(4+i*2,pcm[i]!,true);
    if(crc32(raw)!==view.getUint32(12,true))return null;
    accepted=true;return {kind:bytes[4]!,speaking:bytes[5]===1,loudness:view.getUint16(6,true)/65535,pcm};
  }catch{return null}
  finally{raw.fill(0);if(!accepted)pcm.fill(0)}
}
