import type {Env} from "../env";
import {EAR_REPLIES} from "./index";
import {graphAccess,smallJson,EarRetry} from "./http";
export type ReplyKind=keyof typeof EAR_REPLIES;
export type EarDelivery={state:"blocked"|"sent"|"unknown"};
/** Only approved, parameterless templates with the exact content-free body may be sent. */
export async function replyEar(env:Env,operation:string,to:string,kind:ReplyKind,send:typeof fetch=fetch):Promise<EarDelivery>{
  const blocked=async()=>{await env.DB.prepare("UPDATE ear_operations SET reply_state = 'blocked' WHERE op_key = ? AND reply_state = 'pending'").bind(operation).run();return {state:"blocked" as const}};
  if(env.RA_EAR_VERIFIED!=="true"||!/^\d{3,30}$/.test(env.EAR_PHONE_ID??"")||!/^\d{3,30}$/.test(env.EAR_BUSINESS_ID??"")||!/^\d{5,20}$/.test(to)||!env.EAR_TEMPLATES||env.EAR_TEMPLATES.length>8192)return blocked();
  let value:unknown;try{value=JSON.parse(env.EAR_TEMPLATES)}catch{return blocked()}
  if(!value||typeof value!=="object"||!Object.hasOwn(value,kind))return blocked();const template=(value as Record<string,unknown>)[kind] as {name?:unknown;language?:unknown};
  if(!template||typeof template.name!=="string"||!/^[a-z0-9_]{1,128}$/.test(template.name)||typeof template.language!=="string"||!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language))return blocked();
  const row=await env.DB.prepare("SELECT reply_state,reply_kind,processed FROM ear_operations WHERE op_key = ?").bind(operation).first<{reply_state:string;reply_kind:string|null;processed:number}>();
  if(!row||row.reply_kind!==kind||!row.processed)return blocked();if(row.reply_state==="sent")return {state:"sent"};if(["attempting","unknown"].includes(row.reply_state))return {state:"unknown"};
  const access=await graphAccess(env);if(!access)return blocked();
  const lookup=await send(`${access.base}/${env.EAR_BUSINESS_ID}/message_templates?name=${encodeURIComponent(template.name)}&fields=name,status,language,components&limit=100`,{headers:{Authorization:"Bearer "+access.token},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15_000)});
  if(!lookup.ok)throw new EarRetry("Template approval could not be checked.");
  const listing=await smallJson(lookup) as {data?:unknown[]};const approved=Array.isArray(listing?.data)&&listing.data.some(raw=>{const item=raw as {name?:unknown;status?:unknown;language?:unknown;components?:{type?:unknown;text?:unknown}[]};return item?.name===template.name&&item.status==="APPROVED"&&item.language===template.language&&Array.isArray(item.components)&&item.components.length===1&&item.components[0]?.type==="BODY"&&item.components[0].text===EAR_REPLIES[kind]});
  if(!approved)return blocked();
  const claimed=await env.DB.prepare("UPDATE ear_operations SET reply_state = 'attempting' WHERE op_key = ? AND processed = 1 AND reply_kind = ? AND reply_state IN ('pending','blocked')").bind(operation,kind).run();if(!claimed.meta.changes)return {state:"unknown"};
  let state:"sent"|"unknown"="unknown";
  try{
    const response=await send(`${access.base}/${env.EAR_PHONE_ID}/messages`,{method:"POST",headers:{Authorization:"Bearer "+access.token,"content-type":"application/json"},redirect:"error",signal:AbortSignal.timeout(15_000),body:JSON.stringify({messaging_product:"whatsapp",to,type:"template",template:{name:template.name,language:{code:template.language}}})});
    if(response.status===429){await response.body?.cancel();await env.DB.prepare("UPDATE ear_operations SET reply_state = 'pending' WHERE op_key = ? AND reply_state = 'attempting'").bind(operation).run();throw new EarRetry("Ear delivery is rate limited.")}
    if(response.ok){const result=await smallJson(response) as {messages?:{id?:unknown}[]};if(typeof result?.messages?.[0]?.id==="string")state="sent"}else await response.body?.cancel();
  }catch(error){if(error instanceof EarRetry)throw error}
  await env.DB.prepare("UPDATE ear_operations SET reply_state = ? WHERE op_key = ? AND reply_state = 'attempting'").bind(state,operation).run();return {state};
}
