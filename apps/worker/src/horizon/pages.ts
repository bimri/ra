import type {HorizonDocument} from "@ra/core";
const MAX_BYTES=524288;
// Exact public publisher hosts, not wildcards or model-selected arbitrary URLs.
// Adding a publisher is a source-policy code change, never a model action.
export const SOURCE_HOSTS:Readonly<Record<string,readonly string[]>>={
  "energy-ai":["iea.org","www.iea.org","irena.org","www.irena.org","energy.gov","www.energy.gov","nrel.gov","www.nrel.gov","nlr.gov","www.nlr.gov","sandia.gov","www.sandia.gov","openrepair.org","standard.openrepair.org"],
  "maths-physics":["arxiv.org","www.nist.gov","nist.gov","home.cern","journals.aps.org"],
};
export class SourceIssue extends Error{constructor(){super("Horizon source unavailable")}}
export const normalizeSourceText=(text:string)=>text.normalize("NFC").replace(/\s+/gu," ").trim();
function decode(text:string):string{return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,entity=>{const named:Record<string,string>={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "},value=entity.slice(1,-1).toLowerCase();if(value in named)return named[value]!;const number=value.startsWith("#x")?parseInt(value.slice(2),16):parseInt(value.slice(1),10);return Number.isInteger(number)&&number>0&&number<=0x10ffff&&!(number>=0xd800&&number<=0xdfff)?String.fromCodePoint(number):" "})}
/** Native parser removes non-document/hidden content before text normalization. */
export async function visibleSourceText(html:string):Promise<string>{
  const clean=await new HTMLRewriter().on("script,style,template,noscript,svg,head,nav,footer,[hidden],[aria-hidden='true']",{element(element){element.remove()}}).transform(new Response(html,{headers:{"content-type":"text/html; charset=utf-8"}})).text();
  return normalizeSourceText(decode(clean.replace(/<!--[\s\S]*?-->/g,"").replace(/<\/?(?:p|div|article|section|h[1-6]|li|tr|td|th|br|hr)\b[^>]*>/gi," ").replace(/<[^>]*>/g,"")));
}
function permitted(value:string,hosts:readonly string[]):URL{let url:URL;try{url=new URL(value)}catch{throw new SourceIssue()};if(url.protocol!=="https:"||url.username||url.password||url.port&&url.port!=="443"||!hosts.includes(url.hostname))throw new SourceIssue();url.hash="";return url}
export async function sourceAwait<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{signal.throwIfAborted();let abort:(()=>void)|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort()})])}finally{if(abort)signal.removeEventListener("abort",abort)}}
export interface SourcePage {url:string;text:string;checkedAt:number;contentHash:string}
export function pageReader(fieldId:string,options:{send?:typeof fetch;extract?:(html:string)=>Promise<string>;now?:()=>number}={}){
  const hosts=SOURCE_HOSTS[fieldId]??[],send=options.send??fetch,extract=options.extract??visibleSourceText,clock=options.now??Date.now;
  return async(url:string,parent:AbortSignal):Promise<SourcePage>=>{
    const signal=AbortSignal.any([parent,AbortSignal.timeout(10_000)]);signal.throwIfAborted();let target=permitted(url,hosts),response:Response|undefined;
    try{
      for(let hop=0;hop<3;hop++){
        const pending=send(target,{redirect:"manual",signal,headers:{accept:"text/html,text/plain"}});void pending.then(r=>{if(signal.aborted)void r.body?.cancel().catch(()=>{})},()=>{});
        response=await sourceAwait(pending,signal);
        if([301,302,303,307,308].includes(response.status)){const next=response.headers.get("location");void response.body?.cancel().catch(()=>{});response=undefined;if(!next)throw new SourceIssue();target=permitted(new URL(next,target).href,hosts);continue}break;
      }
      if(!response?.ok||!response.body)throw new SourceIssue();const type=response.headers.get("content-type")??"";
      const charset=/charset\s*=\s*["']?([^;"'\s]+)/i.exec(type)?.[1]?.toLowerCase();
      if(!/^(text\/html|text\/plain)(?:;|$)/i.test(type)||charset&&charset!=="utf-8")throw new SourceIssue();
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const next=await sourceAwait(reader.read(),signal);signal.throwIfAborted();if(next.done)break;size+=next.value.byteLength;if(size>MAX_BYTES)throw new SourceIssue();chunks.push(next.value)}}finally{void reader.cancel().catch(()=>{});reader.releaseLock()}
      const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
      const raw=new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(bytes),text=type.toLowerCase().startsWith("text/html")?await sourceAwait(extract(raw),signal):normalizeSourceText(raw);
      signal.throwIfAborted();if(!text||new TextEncoder().encode(text).byteLength>MAX_BYTES)throw new SourceIssue();
      const hash=await crypto.subtle.digest("SHA-256",bytes);signal.throwIfAborted();
      return {url,text,checkedAt:clock(),contentHash:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("")};
    }catch{parent.throwIfAborted();throw new SourceIssue()}finally{if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{})}
  };
}
export function documentQuote(page:SourcePage,quote:string):HorizonDocument|null{
  const literal=normalizeSourceText(quote);if(literal.length<12||literal.length>800||literal.split(/\s+/u).length>80||!page.text.includes(literal))return null;
  return {url:page.url,quote:literal,checkedAt:page.checkedAt,publishedAt:null,contentHash:page.contentHash};
}
