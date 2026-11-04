import type {RaEvent,Views} from "@ra/core";
import type {WorkflowArchive} from "./workflowArchive";
export interface ExportEvidence {evidenceId:string;type:string;bytes:Uint8Array}
/** One opened R2 file at a time; media bytes are wiped after consumption or cancellation. */
export async function* mindExport(data:{events:RaEvent[];views:Views;workflowArchives?:WorkflowArchive[]},read:{voice(id:string):Promise<Uint8Array|null>;evidence(eventId:string):Promise<ExportEvidence|null>}):AsyncGenerator<string> {
  async function* file(meta:Record<string,string>,bytes:Uint8Array) {
    try {
      yield JSON.stringify(meta).slice(0,-1)+',"base64":"';
      for(let at=0;at<bytes.length;at+=24576)yield btoa(String.fromCharCode(...bytes.subarray(at,at+24576)));
      yield '"}';
    }finally{bytes.fill(0)}
  }
  const missing:{kind:"voice"|"evidence";id:string}[]=[];
  yield JSON.stringify(data).slice(0,-1)+',"voice":[';let first=true;
  const ids=new Set(data.events.flatMap(e=>e.kind==="utterance"&&"audioKey" in e.body&&e.body.audioKey?[String((e.body as {utteranceId:string}).utteranceId)]:[]));
  for(const id of ids) {
    const clip=await read.voice(id);if(!clip){missing.push({kind:"voice",id});continue}
    try{if(!first)yield ",";first=false;yield* file({utteranceId:id,type:"audio/wav"},clip)}finally{clip.fill(0)}
  }
  yield '],"media":[';first=true;
  for(const event of data.events)if(event.kind==="evidence.added"&&"r2Key" in event.body&&event.body.r2Key) {
    const media=await read.evidence(event.id);if(!media){missing.push({kind:"evidence",id:event.id});continue}
    try{if(!first)yield ",";first=false;yield* file({evidenceId:media.evidenceId,type:media.type},media.bytes)}finally{media.bytes.fill(0)}
  }
  yield '],"unavailableMedia":'+JSON.stringify(missing)+'}';
}
