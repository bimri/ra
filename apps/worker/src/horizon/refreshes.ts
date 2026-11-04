import type {HorizonRefreshStatus} from "@ra/core";
export const HORIZON_WEEK=7*86_400_000,HORIZON_LEASE=15*60_000;
export interface RefreshOperation {week:number;operationId:string;attempt:number}
type Row={week:number;operation_id:string;attempt:number;state:HorizonRefreshStatus["state"];updated_at:number;retry_at:number|null;written:number};
/** Public, content-free reservations. Every mutation runs synchronously inside
 * the owning DO's transaction, including the snapshot commit callback. */
export class HorizonRefreshes {
  constructor(private readonly sql:SqlStorage,private readonly atomic:<T>(fn:()=>T)=>T){}
  reserve(field:string,now:number):RefreshOperation|null{return this.atomic(()=>{
    const week=Math.floor(now/HORIZON_WEEK),old=this.sql.exec<Row>("SELECT * FROM horizon_refresh WHERE week=?",week).toArray()[0];
    if(old&&(old.state==="complete"||old.attempt>=3||old.state==="failed"&&old.retry_at!==null&&old.retry_at>now||["queued","running"].includes(old.state)&&old.updated_at+HORIZON_LEASE>now))return null;
    const attempt=(old?.attempt??0)+1,operationId=`horizon-v2-${field}-${week}-${attempt}`;
    this.sql.exec("INSERT OR REPLACE INTO horizon_refresh(week,operation_id,attempt,state,updated_at,retry_at,written) VALUES(?,?,?,'queued',?,NULL,0)",week,operationId,attempt,now);
    this.sql.exec("INSERT OR REPLACE INTO meta(key,value) VALUES('horizon-generation',?)",operationId);
    this.sql.exec("DELETE FROM horizon_refresh WHERE week<?",week-8);
    return {week,operationId,attempt};
  })}
  private current(id:string):Row|null{
    if(this.sql.exec<{value:string}>("SELECT value FROM meta WHERE key='horizon-generation'").toArray()[0]?.value!==id)return null;
    return this.sql.exec<Row>("SELECT * FROM horizon_refresh WHERE operation_id=?",id).toArray()[0]??null;
  }
  begin(id:string,now:number):boolean{return this.atomic(()=>{const row=this.current(id);if(!row||!["queued","running"].includes(row.state))return false;this.sql.exec("UPDATE horizon_refresh SET state='running',updated_at=? WHERE operation_id=?",now,id);return true})}
  finish(id:string,now:number,write:()=>number):number|null{return this.atomic(()=>{
    const row=this.current(id);if(!row)return null;if(row.state==="complete")return row.written;if(!["queued","running"].includes(row.state))return null;
    const written=write();this.sql.exec("UPDATE horizon_refresh SET state='complete',updated_at=?,retry_at=NULL,written=? WHERE operation_id=?",now,written,id);return written;
  })}
  fail(id:string,now:number):void{this.atomic(()=>{const row=this.current(id);if(!row||!["queued","running"].includes(row.state))return;const retry=row.attempt>=3?null:now+(row.attempt===1?5*60_000:60*60_000);this.sql.exec("UPDATE horizon_refresh SET state='failed',updated_at=?,retry_at=? WHERE operation_id=?",now,retry,id)})}
  status():HorizonRefreshStatus{
    const row=this.sql.exec<Row>("SELECT * FROM horizon_refresh ORDER BY week DESC LIMIT 1").toArray()[0];
    return row?{state:row.state,checkedAt:row.updated_at,retryAt:row.retry_at,problem:row.state==="failed"?"unavailable":null}:{state:"idle",checkedAt:null,retryAt:null,problem:null};
  }
}
