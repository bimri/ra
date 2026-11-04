import type {Env} from "../env";
export interface EarProjection{revision:number;generation:string|null;discreet:boolean}
/** Queue together with the authoritative link mutation. Revisions prevent stale relinking. */
export function queueEar(env:Env,account:string):D1PreparedStatement{
  return env.DB.prepare("INSERT INTO ear_accounts(account) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM people_erased WHERE account = ?) ON CONFLICT(account) DO UPDATE SET revision = revision + 1").bind(account,account);
}
export async function reconcileEar(env:Env,account:string):Promise<{pending:number}>{
  const job=await env.DB.prepare("SELECT revision FROM ear_accounts WHERE account = ? AND revision > delivered AND NOT EXISTS (SELECT 1 FROM people_erased WHERE account = ?)").bind(account,account).first<{revision:number}>();if(!job)return {pending:0};
  try{
    const link=await env.DB.prepare("SELECT generation,discreet FROM ear_links WHERE account = ? AND generation IS NOT NULL ORDER BY linked_at DESC LIMIT 1").bind(account).first<{generation:string;discreet:number}>();
    await env.MIND.getByName(account).earProjection({revision:job.revision,generation:link?.generation??null,discreet:link?.discreet!==0});
    await env.DB.prepare("UPDATE ear_accounts SET delivered = ? WHERE account = ? AND revision = ?").bind(job.revision,account,job.revision).run();return {pending:0};
  }catch{return {pending:1}}
}
