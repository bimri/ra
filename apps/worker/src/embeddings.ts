import type { Env } from "./env";

export const EMBED_DIMENSIONS=1024;
export const EMBED_TEXT_BYTES=8192;
export const EMBED_BATCH_BYTES=65536;
export function validEmbedding(value:unknown):value is number[]{
  if(!Array.isArray(value)||value.length!==EMBED_DIMENSIONS||!value.every(v=>typeof v==="number"&&Number.isFinite(v)))return false;
  const norm=value.reduce((sum,v)=>sum+v*v,0);return norm>0&&Number.isFinite(norm);
}
/** Exact bge-m3 only. Missing, malformed or unavailable results are never substituted. */
export async function embed(env: Env, texts: string[],signal?:AbortSignal): Promise<(number[] | null)[]> {
  if (!env.AI || texts.length === 0) return texts.map(() => null);
  const sizes=texts.map(text=>new TextEncoder().encode(text).length);
  if(texts.length>32||sizes.some(size=>!size||size>EMBED_TEXT_BYTES)||sizes.reduce((a,b)=>a+b,0)>EMBED_BATCH_BYTES)return texts.map(()=>null);
  const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(12_000)]):AbortSignal.timeout(12_000);
  let abort:(()=>void)|undefined;
  try {
    deadline.throwIfAborted();
    const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(deadline.reason);deadline.addEventListener("abort",abort,{once:true});if(deadline.aborted)abort()});
    const out = await Promise.race([env.AI.run("@cf/baai/bge-m3",{text:texts,truncate_inputs:false},{signal:deadline}),cancelled]) as {data?:unknown;shape?:unknown};
    deadline.throwIfAborted();
    if(!out||!Array.isArray(out.data)||out.data.length!==texts.length||out.shape!==undefined&&(!Array.isArray(out.shape)||out.shape.length!==2||out.shape[0]!==texts.length||out.shape[1]!==EMBED_DIMENSIONS))return texts.map(()=>null);
    return out.data.map(value=>validEmbedding(value)?value:null);
  } catch (e) {
    signal?.throwIfAborted();
    console.log(JSON.stringify({ ra: "embed", failed:true }));
    return texts.map(() => null);
  }finally{if(abort)deadline.removeEventListener("abort",abort)}
}
