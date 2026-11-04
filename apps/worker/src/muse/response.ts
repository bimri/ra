export interface MuseResponseData{status?:unknown;id?:unknown;output?:unknown}
/** The reason is a fixed tag or a provider code, never provider text. */
const invalid=(why="")=>new Error("Muse returned an invalid or interrupted response"+(why?` (${why})`:""));
const code=(v:unknown)=>typeof v==="string"&&/^[a-z0-9_.]{1,64}$/i.test(v)?v:"?";
const MAX_BODY=1_048_576,MAX_EVENT=262_144,MAX_EVENTS=8192;
/** Bounded stateless Responses reader. Partial tokens are never committed or spoken. */
export async function readMuseResponse(response:Response,signal:AbortSignal):Promise<MuseResponseData>{
  signal.throwIfAborted();if(!response.body)throw invalid();
  const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}),encoder=new TextEncoder();
  const streaming=(response.headers.get("content-type")??"").split(';')[0]?.trim()==="text/event-stream";
  if(!streaming&&!(response.headers.get("content-type")??"").includes("application/json")){await reader.cancel().catch(()=>{});throw invalid()}
  let bytes=0,buffer="",data:string[]=[],eventName="",eventBytes=0,events=0,sequence=-1,responseId:string|null=null,deltaBytes=0;
  let final:MuseResponseData|null=null;
  const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
  function dispatch(){
    if(!data.length){eventName="";eventBytes=0;return}
    const text=data.join('\n');data=[];eventBytes=0;
    if(text==="[DONE]")throw invalid("done before completion");
    let value:unknown;try{value=JSON.parse(text)}catch{throw invalid("event json")}
    if(!object(value)||typeof value.type!=="string")throw invalid("event shape");if(eventName&&eventName!==value.type)throw invalid(`event name ${code(eventName)} vs ${code(value.type)}`);if(++events>MAX_EVENTS)throw invalid("too many events");eventName="";
    if(value.sequence_number!==undefined){if(!Number.isSafeInteger(value.sequence_number)||(value.sequence_number as number)<=sequence)throw invalid(`sequence ${String(value.sequence_number).slice(0,12)} after ${sequence} at ${code(value.type)}`);sequence=value.sequence_number as number}
    if(value.type==="error"||value.type==="response.failed"||value.type==="response.incomplete"){
      const r=object(value.response)?value.response:{},details=object(r.incomplete_details)?r.incomplete_details:{},error=object(r.error)?r.error:object(value.error)?value.error:value;
      throw invalid(`${value.type}: ${code(details.reason??error.code??error.type)}`);
    }
    if(value.type==="response.created"){
      if(!object(value.response)||typeof value.response.id!=="string"||!value.response.id||responseId&&responseId!==value.response.id)throw invalid("created id");responseId=value.response.id;
    }
    if(value.type==="response.output_text.delta"){
      if(typeof value.delta!=="string")throw invalid("delta shape");deltaBytes+=encoder.encode(value.delta).length;if(deltaBytes>64_000)throw invalid("delta size");
    }
    if(value.type==="response.completed"){
      if(!object(value.response)||value.response.status!=="completed"||responseId&&value.response.id!==responseId)throw invalid(`completed ${object(value.response)?code(value.response.status):"shape"}${responseId&&object(value.response)&&value.response.id!==responseId?" id":""}`);final=value.response;
    }
  }
  function line(value:string){
    eventBytes+=encoder.encode(value).length+1;if(eventBytes>MAX_EVENT)throw invalid("event size");
    if(value===""){dispatch();return}if(value.startsWith(':'))return;
    const colon=value.indexOf(':'),field=colon<0?value:value.slice(0,colon),content=colon<0?"":value.slice(colon+1).replace(/^ /,"");
    if(field==="data")data.push(content);else if(field==="event")eventName=content;
  }
  let aborted:(()=>void)|undefined;
  const cancellation=new Promise<never>((_,reject)=>{aborted=()=>{void reader.cancel().catch(()=>{});reject(signal.reason??invalid())};signal.addEventListener("abort",aborted,{once:true});if(signal.aborted)aborted()});
  try{
    while(true){
      const next=await Promise.race([reader.read(),cancellation]);signal.throwIfAborted();
      if(next.value){bytes+=next.value.byteLength;if(bytes>MAX_BODY)throw invalid();buffer+=decoder.decode(next.value,{stream:true})}
      if(next.done)buffer+=decoder.decode();
      if(!streaming){if(next.done){let value:unknown;try{value=JSON.parse(buffer)}catch{throw invalid()}if(!object(value))throw invalid();return value}continue}
      while(buffer){const newline=/\r\n|\r|\n/.exec(buffer);if(!newline)break;if(newline[0]==='\r'&&newline.index===buffer.length-1&&!next.done)break;line(buffer.slice(0,newline.index));buffer=buffer.slice(newline.index+newline[0].length);if(final){signal.throwIfAborted();return final}}
      if(encoder.encode(buffer).length>MAX_EVENT)throw invalid();
      if(next.done){if(buffer)line(buffer);dispatch();if(final)return final;throw invalid(`ended without completion after ${events} events`)}
    }
  }finally{
    if(aborted)signal.removeEventListener("abort",aborted);
    // Do not await a non-cooperative upstream cancellation after a local lock.
    void reader.cancel().catch(()=>{});reader.releaseLock();buffer="";data=[];
  }
}
