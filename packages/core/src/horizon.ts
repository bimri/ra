/** Public source evidence. Never contains a person's Mind or account identity. */
export interface HorizonDocument {url:string;quote:string;checkedAt:number;publishedAt:null;contentHash:string}
export interface HorizonVerification {version:1;kind:string;summary:string;timing:string|null;direction?:string;staysHuman?:string;checkedAt:number;documents:HorizonDocument[];support:number;relevance:number}
export interface HorizonRefreshStatus {state:"idle"|"queued"|"running"|"complete"|"failed";checkedAt:number|null;retryAt:number|null;problem:"unavailable"|null}
const source=(value:unknown):value is string=>{if(typeof value!=="string")return false;try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password&&(!url.port||url.port==="443")}catch{return false}};
/** A legacy URL is not source verification. Keep old records readable while
 * requiring fresh, claim-bound evidence for new generation and Readings. */
export function verifiedHorizon(signal:{kind?:string;text:string;timing?:string;direction?:string;staysHuman?:string;sources?:readonly string[];seeded?:boolean;verification?:HorizonVerification},now:number,maxAge=30*86_400_000):boolean{
  const v=signal.verification;if(!Number.isFinite(now)||!Number.isFinite(maxAge)||maxAge<0||!Array.isArray(signal.sources)||!["risen","rising","early","stays-human","on-ramp"].includes(signal.kind??"")||typeof signal.text!=="string"||signal.seeded||!v||v.version!==1||v.kind!==signal.kind||v.summary!==signal.text||v.timing!==(signal.timing??null)||!Number.isFinite(v.checkedAt)||v.checkedAt>now||v.checkedAt<now-maxAge)return false;
  if(!Number.isFinite(v.support)||v.support<.8||v.support>1||!Number.isFinite(v.relevance)||v.relevance<.8||v.relevance>1||!Array.isArray(v.documents)||!v.documents.length||v.documents.length>2)return false;
  if((v.direction??null)!==(signal.direction??null)||(v.staysHuman??null)!==(signal.staysHuman??null))return false;
  const seen=new Set<string>();
  for(const d of v.documents){if(!d||!source(d.url)||seen.has(d.url)||typeof d.quote!=="string"||d.quote.trim().length<12||d.quote.length>800||typeof d.contentHash!=="string"||!/^([a-f0-9]{64})$/.test(d.contentHash)||d.publishedAt!==null||!Number.isFinite(d.checkedAt)||d.checkedAt<v.checkedAt||d.checkedAt>now||!signal.sources?.includes(d.url))return false;seen.add(d.url)}
  return signal.sources?.length===seen.size&&(!signal.timing||v.documents.some(d=>d.quote.includes(signal.timing!)));
}
/** A repeated excerpt is not new news because an LLM paraphrased its summary,
 * the HTML shell changed, or a page was fetched again. */
export function horizonFactKey(signal:{kind?:string;text:string;sources?:readonly string[];timing?:string;direction?:string;verification?:HorizonVerification}):string{
  const evidence=signal.verification?.documents.map(({url,quote})=>({url,quote})).sort((a,b)=>a.url<b.url?-1:a.url>b.url?1:0)??null;
  return JSON.stringify([signal.kind??null,evidence??[signal.text,[...(signal.sources??[])].sort()],signal.timing??null,signal.direction??null]);
}
