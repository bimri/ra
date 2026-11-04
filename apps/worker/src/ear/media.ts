import {OpusDecoder} from "./codecs/opus-runtime.js";
export class EarMediaError extends Error{}
const MAX_BYTES=8*1024*1024,MAX_SAMPLES=16000*120;
function fail():never{throw new EarMediaError("This recording could not be decoded completely. Try a shorter supported recording.")}
const ascii=(bytes:Uint8Array,at:number,text:string)=>text.split("").every((char,i)=>bytes[at+i]===char.charCodeAt(0));
const table=Uint32Array.from({length:256},(_,value)=>{let crc=value<<24;for(let bit=0;bit<8;bit++)crc=crc&0x80000000?(crc<<1)^0x04c11db7:crc<<1;return crc>>>0});
/** Ogg's non-reflected CRC, including the header with its checksum bytes treated as zero. */
export function oggChecksum(bytes:Uint8Array):number{let crc=0;for(let i=0;i<bytes.length;i++)crc=((crc<<8)^table[((crc>>>24)^(i>=22&&i<26?0:bytes[i]!))&255]!)>>>0;return crc}
interface Page{bytes:Uint8Array;flags:number;granule:bigint;laces:Uint8Array;body:number}
/** Single complete logical stream only. Never recover past a corrupt page or accept a shortened file. */
function* pages(bytes:Uint8Array):Generator<Page>{
  let offset=0,serial:number|null=null,sequence=0,ended=false,continued=false,count=0,last=0n;
  while(offset<bytes.length){
    if(ended||++count>20_000||offset+27>bytes.length||!ascii(bytes,offset,"OggS")||bytes[offset+4]!==0)fail();
    const view=new DataView(bytes.buffer,bytes.byteOffset+offset),flags=bytes[offset+5]!,segments=bytes[offset+26]!,header=27+segments;
    if(flags&~7||offset+header>bytes.length)fail();const laces=bytes.subarray(offset+27,offset+header),length=header+laces.reduce((sum,n)=>sum+n,0);if(offset+length>bytes.length)fail();
    const page=bytes.subarray(offset,offset+length),id=view.getUint32(14,true),number=view.getUint32(18,true),granule=view.getBigUint64(6,true);
    if(serial===null){if(flags!==2||number!==0)fail();serial=id}else if(id!==serial||flags&2)fail();
    if(number!==sequence||!!(flags&1)!==continued||oggChecksum(page)!==view.getUint32(22,true))fail();sequence=(sequence+1)>>>0;
    if(laces.length)continued=laces.at(-1)===255;
    if(granule!==0xffffffffffffffffn){if(granule<last)fail();last=granule}
    ended=!!(flags&4);if(ended&&(continued||granule===0xffffffffffffffffn))fail();yield {bytes:page,flags,granule,laces,body:header};offset+=length;
  }
  if(!ended||continued)fail();
}
function* packets(bytes:Uint8Array):Generator<Uint8Array>{
  let parts:Uint8Array[]=[],length=0,count=0;
  for(const page of pages(bytes)){let at=page.body;for(const size of page.laces){parts.push(page.bytes.subarray(at,at+size));at+=size;length+=size;if(length>65536)fail();if(size<255){if(++count>50002)fail();const packet=new Uint8Array(length);let write=0;for(const part of parts){packet.set(part,write);write+=part.length}parts=[];length=0;yield packet}}}
  if(length||parts.length)fail();
}
function pcmWave(bytes:Uint8Array):Int16Array{
  if(bytes.length<44||!ascii(bytes,0,"RIFF")||!ascii(bytes,8,"WAVE"))fail();const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint32(4,true)+8!==bytes.length)fail();
  let format=false,data:Uint8Array|null=null,at=12;
  while(at+8<=bytes.length){const size=view.getUint32(at+4,true),end=at+8+size;if(end>bytes.length)fail();
    if(ascii(bytes,at,"fmt ")){if(format||size<16||view.getUint16(at+8,true)!==1||view.getUint16(at+10,true)!==1||view.getUint32(at+12,true)!==16000||view.getUint32(at+16,true)!==32000||view.getUint16(at+20,true)!==2||view.getUint16(at+22,true)!==16)fail();format=true}
    else if(ascii(bytes,at,"data")){if(data)fail();data=bytes.subarray(at+8,end)}at=end+(size&1);
  }
  if(at!==bytes.length||!format||!data||!data.length||data.length%2||data.length/2>MAX_SAMPLES)fail();const samples=new Int16Array(data.length/2),source=new DataView(data.buffer,data.byteOffset,data.byteLength);for(let i=0;i<samples.length;i++)samples[i]=source.getInt16(i*2,true);return samples;
}
/** Decode into canonical 16 kHz mono PCM. The Opus module is pinned and statically compiled at build time. */
export async function decodeEarAudio(bytes:Uint8Array,type:string,module:WebAssembly.Module):Promise<Int16Array>{
  if(!bytes.length||bytes.length>MAX_BYTES)fail();const mime=type.split(";")[0]!.trim().toLowerCase();
  if(["audio/wav","audio/x-wav","audio/wave"].includes(mime))return pcmWave(bytes);
  if(!["audio/ogg","application/ogg"].includes(mime)||!ascii(bytes,0,"OggS"))fail();
  let terminal=0n;for(const page of pages(bytes))if(page.flags&4)terminal=page.granule;
  const stream=packets(bytes),head=stream.next().value as Uint8Array|undefined;if(!head||head.length!==19||!ascii(head,0,"OpusHead")||head[8]!==1||![1,2].includes(head[9]!)||head[18]!==0)fail();
  const header=new DataView(head.buffer,head.byteOffset,head.byteLength),channels=head[9]!,preSkip=header.getUint16(10,true),gain=10**(header.getInt16(16,true)/5120);
  if(terminal<BigInt(preSkip)||terminal-BigInt(preSkip)>BigInt(MAX_SAMPLES*3))fail();const wanted=Math.round(Number(terminal-BigInt(preSkip))/3);if(wanted<1)fail();
  const tags=stream.next().value as Uint8Array|undefined;if(!tags||tags.length<16||!ascii(tags,0,"OpusTags"))fail();const tagView=new DataView(tags.buffer,tags.byteOffset,tags.byteLength);let tagAt=12+tagView.getUint32(8,true);if(tagAt+4>tags.length)fail();const comments=tagView.getUint32(tagAt,true);tagAt+=4;if(comments>1024)fail();for(let i=0;i<comments;i++){if(tagAt+4>tags.length)fail();const size=tagView.getUint32(tagAt,true);tagAt+=4+size;if(tagAt>tags.length)fail()}
  OpusDecoder.module=module;const decoder=new OpusDecoder({sampleRate:16000,channels,preSkip:Math.round(preSkip/3)}),chunks:Int16Array[]=[];let total=0;
  try{
    await decoder.ready;
    for(let next=stream.next();!next.done;next=stream.next()){
      const packet=next.value;if(!packet.length||packet.length>3840*channels)fail();const decoded=decoder.decodeFrame(packet);packet.fill(0);
      try{if(decoded.errors.length||decoded.sampleRate!==16000||decoded.channelData.length!==channels||decoded.samplesDecoded<0||decoded.channelData.some(channel=>channel.length!==decoded.samplesDecoded))fail();total+=decoded.samplesDecoded;if(total>MAX_SAMPLES+1920)fail();const pcm=new Int16Array(decoded.samplesDecoded);for(let i=0;i<pcm.length;i++){let value=0;for(const channel of decoded.channelData)value+=channel[i]!;value=value/channels*gain;if(!Number.isFinite(value))fail();pcm[i]=Math.max(-32768,Math.min(32767,Math.round(value*32768)))}chunks.push(pcm)}finally{for(const channel of decoded.channelData)channel.fill(0)}
    }
    if(total<wanted||total-wanted>1920)fail();const result=new Int16Array(wanted);let at=0;for(const chunk of chunks){const take=Math.min(chunk.length,wanted-at);if(take>0)result.set(chunk.subarray(0,take),at);at+=take}return result;
  }finally{
    for(const chunk of chunks)chunk.fill(0);const heap=(decoder as unknown as {_common?:{wasm?:{HEAP?:ArrayBuffer}}})._common?.wasm?.HEAP;try{decoder.free()}finally{if(heap)new Uint8Array(heap).fill(0)}
  }
}
export function earImageType(bytes:Uint8Array):"image/jpeg"|"image/png"{
  if(!bytes.length||bytes.length>MAX_BYTES)throw new EarMediaError("This image is too large to keep.");
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return "image/png";
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "image/jpeg";
  throw new EarMediaError("This image format is unavailable. Choose a JPEG or PNG in Ra.");
}
