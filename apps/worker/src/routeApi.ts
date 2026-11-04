import {isId} from "@ra/core";
import type {MindDO} from "./mind/MindDO";
const headers={"content-type":"application/json","cache-control":"private, no-store"};
async function bodyOf(request:Request):Promise<Record<string,unknown>> {
  if(!request.headers.get("content-type")?.startsWith("application/json"))throw new Error("JSON is required.");
  const reader=request.body?.getReader();if(!reader)throw new Error("A request is needed.");
  const parts:Uint8Array[]=[];let length=0;let raw:Uint8Array|null=null;
  try{
    for(;;){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>8192){next.value.fill(0);throw new Error("The route request is too large.")}parts.push(next.value)}
    raw=new Uint8Array(length);let at=0;for(const part of parts){raw.set(part,at);at+=part.length}
    const value=JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(raw));if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value;
  }catch{await reader.cancel().catch(()=>{});throw new Error("Use a route request of at most 8 KiB.")}
  finally{raw?.fill(0);for(const part of parts)part.fill(0);reader.releaseLock()}
}
/** Session/account routing is enforced by the application entry before invoking this handler. */
export async function routeApi(request:Request,mind:DurableObjectStub<MindDO>):Promise<Response> {
  const path=new URL(request.url).pathname;const get=path==="/route/status"||path==="/dial/status";
  if(request.method!==(get?"GET":"POST"))return Response.json({error:"Method not allowed."},{status:405,headers});
  let body:Record<string,unknown>;try{body=get?Object.fromEntries(new URL(request.url).searchParams):await bodyOf(request)}catch{return Response.json({error:"Use a route request of at most 8 KiB."},{status:400,headers})}
  if(path==="/dial/evidence"){const reply=await mind.checkDialEvidence(body);return Response.json(reply,{status:reply.ok?200:409,headers})}
  if(path.startsWith("/dial/")){
    if(!isId(body.operationId)||body.retry!==undefined&&typeof body.retry!=="boolean")return Response.json({error:"Invalid Dial request."},{status:400,headers});
    const reply=await mind.dialAction(path==="/dial/generate"?"generate":path==="/dial/cancel"?"cancel":"status",body.operationId,body,body.retry===true);return Response.json(reply.ok?reply.job:{error:reply.error},{status:reply.ok?200:reply.status,headers});
  }
  if(!isId(body.operationId))return Response.json({error:"Invalid route request."},{status:400,headers});
  if(path==="/route/propose"&&(typeof body.circumstances!=="string"||body.circumstances.length>1000||!body.circumstances.trim()||body.retry!==undefined&&typeof body.retry!=="boolean"))return Response.json({error:"Describe your available time, tools and access in up to 1,000 characters."},{status:400,headers});
  const reply=path==="/route/propose"?await mind.proposeRoute(body.operationId,body.circumstances as string,body.retry===true):path==="/route/accept"?await mind.acceptRoute(body.operationId):path==="/route/cancel"?await mind.cancelRoute(body.operationId):await mind.routeStatus(body.operationId);
  return Response.json(reply.ok?reply.job:{error:reply.error},{status:reply.ok?200:reply.status,headers});
}
