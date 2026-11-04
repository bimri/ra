import type {Env} from "../env";
import {secretOf} from "../env";
import {makeId,rms} from "@ra/core";
import {transcribeClip} from "../transcribe";
import {base64,wav} from "../transcribe/wav";
import {linkCode,messagesOf,signatureOk,waHash,type EarMessage} from "./index";
import {claimEar,earIdentity,type EarOperation} from "./operations";
import {reconcileEar,queueEar} from "./reconcile";
import {boundedBody,downloadEar,EarRetry} from "./http";
import {EarMediaError,earImageType} from "./media";
import {replyEar} from "./delivery";
const privateHeaders={"cache-control":"private, no-store"};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders});
interface EarDeps{send?:typeof fetch;decodeAudio:(bytes:Uint8Array,type:string)=>Promise<Int16Array>;transcribe?:(env:Env,base64:string,language:string)=>Promise<string>}
export async function earLink(request:Request,env:Env,who:string):Promise<Response>{
  if(request.method==="DELETE"){
    await env.DB.batch([env.DB.prepare("DELETE FROM ear_links WHERE account = ?").bind(who),env.DB.prepare("DELETE FROM ear_codes WHERE account = ?").bind(who),env.DB.prepare("UPDATE ear_operations SET processed = 1, reply_kind = NULL, reply_state = 'blocked', lease_token = NULL, lease_until = 0 WHERE account = ?").bind(who),queueEar(env,who)]);
    const result=await reconcileEar(env,who);return new Response(null,{status:result.pending?202:204,headers:privateHeaders});
  }
  const raw=await boundedBody(request.body,4096);let body:{discreet?:unknown};try{body=raw.length?JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(raw)):{};if(!body||typeof body!=="object")return json({error:"Choose the Ear settings."},400)}catch{return json({error:"Choose the Ear settings."},400)}finally{raw.fill(0)}
  const code=linkCode(),expiresAt=Date.now()+600_000;await env.DB.batch([env.DB.prepare("DELETE FROM ear_codes WHERE account = ? OR expires_at < ?").bind(who,Date.now()),env.DB.prepare("INSERT INTO ear_codes(code,account,discreet,expires_at) VALUES (?,?,?,?)").bind(code,who,body.discreet===false?0:1,expiresAt)]);return json({code,number:env.RA_EAR_NUMBER??null,expiresAt});
}
export async function earWebhook(request:Request,env:Env,deps:EarDeps):Promise<Response>{
  const url=new URL(request.url);
  if(request.method==="GET"){const ok=url.searchParams.get("hub.mode")==="subscribe"&&!!env.EAR_VERIFY_TOKEN&&url.searchParams.get("hub.verify_token")===env.EAR_VERIFY_TOKEN;return new Response(ok?url.searchParams.get("hub.challenge")??"":"forbidden",{status:ok?200:403,headers:privateHeaders})}
  if(request.method!=="POST")return new Response("method not allowed",{status:405,headers:privateHeaders});
  if(env.RA_EAR_VERIFIED!=="true"||!env.EAR_PHONE_ID||!env.RA_MASTER_KEY)return new Response("the Ear is unavailable",{status:503,headers:privateHeaders});
  const secret=await secretOf(env.EAR_APP_SECRET);if(!secret)return new Response("the Ear is unavailable",{status:503,headers:privateHeaders});
  let raw:string;try{const bytes=await boundedBody(request.body,2*1024*1024);try{raw=new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(bytes)}finally{bytes.fill(0)}}catch{return new Response("invalid webhook body",{status:413,headers:privateHeaders})}
  if(!await signatureOk(raw,request.headers.get("x-hub-signature-256"),secret))return new Response("bad signature",{status:401,headers:privateHeaders});
  let messages:EarMessage[];try{messages=messagesOf(JSON.parse(raw),env.EAR_PHONE_ID)}catch{return new Response("bad webhook payload",{status:400,headers:privateHeaders})}
  let failed=false;for(const message of messages){try{await receive(message,env,deps)}catch{failed=true;console.warn(JSON.stringify({ra:"ear",retry:true}))}}
  return new Response(failed?"retry":"ok",{status:failed?503:200,headers:privateHeaders});
}
async function active(env:Env,operation:EarOperation,sender:string):Promise<boolean>{
  return !!operation.account&&!!operation.generation&&!!await env.DB.prepare("SELECT 1 FROM ear_links WHERE wa_hash = ? AND account = ? AND generation = ? AND NOT EXISTS (SELECT 1 FROM people_erased WHERE account = ?)").bind(sender,operation.account,operation.generation,operation.account).first();
}
async function receive(message:EarMessage,env:Env,deps:EarDeps):Promise<void>{
  const sender=await waHash(message.from,env.RA_MASTER_KEY!),identity=await earIdentity(sender,env.EAR_PHONE_ID+":"+message.id,env.RA_MASTER_KEY!);let operation=await claimEar(env,message,sender,identity.key);
  if(operation.kind!=="ignored"&&!await active(env,operation,sender)){await env.DB.prepare("UPDATE ear_operations SET processed = 1, reply_kind = NULL, reply_state = 'blocked' WHERE op_key = ?").bind(identity.key).run();return}
  if(!operation.processed){
    const token=makeId(),now=Date.now();const lease=await env.DB.prepare("UPDATE ear_operations SET lease_until = ?, lease_token = ? WHERE op_key = ? AND processed = 0 AND lease_until <= ?").bind(now+120_000,token,identity.key,now).run();if(!lease.meta.changes)throw new EarRetry("This Ear message is already being processed.");
    try{
      if((await reconcileEar(env,operation.account!)).pending)throw new EarRetry("The Ear link is waiting to sync.");
      if(operation.kind==="capture")await capture(message,operation,identity.eventId,sender,env,deps);
      await env.DB.prepare("UPDATE ear_operations SET processed = 1, reply_kind = ?, lease_until = 0, lease_token = NULL WHERE op_key = ? AND lease_token = ?").bind(operation.kind==="link"?"linked":"kept",identity.key,token).run();
    }catch(error){
      if(error instanceof EarMediaError)await env.DB.prepare("UPDATE ear_operations SET processed = 1, reply_kind = 'unheard', lease_until = 0, lease_token = NULL WHERE op_key = ? AND lease_token = ?").bind(identity.key,token).run();
      else{await env.DB.prepare("UPDATE ear_operations SET lease_until = 0, lease_token = NULL WHERE op_key = ? AND lease_token = ?").bind(identity.key,token).run();throw error}
    }
    operation=(await env.DB.prepare("SELECT * FROM ear_operations WHERE op_key = ?").bind(identity.key).first<EarOperation>())!;
  }
  if(operation.reply_kind)await replyEar(env,identity.key,message.from,operation.reply_kind,deps.send);
}
async function capture(message:EarMessage,operation:EarOperation,eventId:string,sender:string,env:Env,deps:EarDeps):Promise<void>{
  const mind=env.MIND.getByName(operation.account!),common={operationId:eventId,generation:operation.generation!,at:message.at!};
  if(message.kind==="text"){if(!message.text.trim()||message.text.length>16_000)throw new EarMediaError("This thought needs review in Ra.");await mind.fileEar({...common,text:message.text});return}
  if(message.kind!=="audio"&&message.kind!=="image")return;
  const media=await downloadEar(env,message.mediaId,deps.send);let pcm:Int16Array|null=null,normalized:Uint8Array|null=null;
  try{
    if(!await active(env,operation,sender))throw new EarRetry("This Ear link changed during processing.");
    if(message.kind==="image"){const type=earImageType(media.bytes);if((message.caption?.length??0)>16_000)throw new EarMediaError("This caption needs review in Ra.");await mind.fileEar({...common,text:message.caption??"",media:{kind:"image",type,bytes:media.bytes}});return}
    pcm=await deps.decodeAudio(media.bytes,media.type);if(pcm.length<3840||rms(pcm)<.002)throw new EarMediaError("No clear voice was available. Try again.");normalized=wav(pcm);
    const text=await (deps.transcribe??transcribeClip)(env,base64(normalized),await mind.listeningIn());if(!text.trim())throw new EarMediaError("This recording needs another look.");
    if(!await active(env,operation,sender))throw new EarRetry("This Ear link changed during processing.");await mind.fileEar({...common,text,media:{kind:"audio",type:"audio/wav",bytes:normalized}});
  }finally{media.bytes.fill(0);pcm?.fill(0);normalized?.fill(0)}
}
