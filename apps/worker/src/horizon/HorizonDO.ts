import { DurableObject } from "cloudflare:workers";
import {verifiedHorizon,type SignalCard,type HorizonRefreshStatus} from "@ra/core";
import seed from "../../../../seed/horizon.json";
import type { Env } from "../env";
import {migrateHorizon} from "./schema";
import {HorizonRefreshes} from "./refreshes";

export type SignalKind = SignalCard["kind"];

export interface Signal extends SignalCard {
  at: number;
  /** From the seed, not yet read by Wonder. */
  seeded: boolean;
}

export interface Field {
  id: string;
  name: string;
  /** What the field covers, used to match a person's story to it. */
  about: string;
}

/** The fields Ra has a Horizon for. Each is one HorizonDO, named by its id. */
export const FIELDS: Field[] = seed.fields.map(({ id, name, about }) => ({ id, name, about }));

/**
 * One Horizon per field, shared by everyone heading there. HorizonRefresh
 * (Wonder with web search) writes it weekly or on first need; until then a
 * demo field starts from its seed.
 */
export class HorizonDO extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly refreshes:HorizonRefreshes;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.refreshes=new HorizonRefreshes(this.sql,fn=>ctx.storage.transactionSync(fn));
    ctx.blockConcurrencyWhile(async () => {
      migrateHorizon(this.sql);
    });
  }

  /** This field's signals, loading the seed the first time if Wonder hasn't read the field yet. */
  async signals(fieldId: string): Promise<Signal[]> {
    if(!FIELDS.some(field=>field.id===fieldId))return [];
    const recorded=this.sql.exec<{value:string}>("SELECT value FROM meta WHERE key='field'").toArray()[0]?.value;
    if(recorded&&recorded!==fieldId||this.ctx.id.name&&this.ctx.id.name!==fieldId)throw new Error("Horizon field mismatch");
    if(!recorded)this.sql.exec("INSERT INTO meta(key,value) VALUES('field',?)",fieldId);
    if (this.env.RA_MUSE_PROVIDER === "muse") {
      const operation=this.refreshes.reserve(fieldId,Date.now());
      // A refresh that can't start is recorded as failed; it never breaks reading the signals already here.
      if(operation)this.ctx.waitUntil(Promise.resolve().then(()=>this.env.HORIZON_REFRESH.create({id:operation.operationId,params:{field:fieldId,operationId:operation.operationId}})).then(()=>undefined,()=>{this.refreshes.fail(operation.operationId,Date.now())}));
    }
    // Until Wonder reads the field, the seed file is the truth: reload it, so edits to it show.
    if (this.count() === 0 || this.onlySeed()) this.loadSeed(fieldId);
    return this.readSignals();
  }

  private readSignals():Signal[]{
    return this.sql
      .exec<{
        id: string;
        kind: string;
        text: string;
        timing: string | null;
        direction: string | null;
        sources: string;
        at: number;
        stays_human: string | null;
        seeded: number;
        verification:string|null;
      }>("SELECT id, kind, text, timing, direction, sources, at, stays_human, seeded,verification FROM signals ORDER BY at DESC, id")
      .toArray()
      .map((r) => ({
        id: r.id,
        kind: r.kind as SignalKind,
        text: r.text,
        ...(r.timing ? { timing: r.timing } : {}),
        ...(r.direction ? { direction: r.direction } : {}),
        ...(r.stays_human ? { staysHuman: r.stays_human } : {}),
        sources: JSON.parse(r.sources) as string[],
        at: r.at,
        seeded: r.seeded === 1,
        ...(r.verification?{verification:JSON.parse(r.verification) as Signal["verification"]}:{}),
      }));
  }

  /** Replace the field's signals (HorizonRefresh). Anything without a source is dropped. */
  async put(signals: Omit<Signal, "seeded">[]): Promise<number> {
    const kept = signals.filter((s) => verifiedHorizon(s,Date.now()));
    if(!kept.length)return 0;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM signals");
      for (const s of kept) this.insert({ ...s, seeded: false });
    });
    return kept.length;
  }

  async refreshStatus():Promise<HorizonRefreshStatus>{return this.refreshes.status()}
  async beginRefresh(operationId:string):Promise<boolean>{return this.refreshes.begin(operationId,Date.now())}
  async failRefresh(operationId:string):Promise<void>{this.refreshes.fail(operationId,Date.now())}
  async finishRefresh(operationId:string,signals:Omit<Signal,"seeded">[]):Promise<number|null>{
    if(signals.length>12||signals.some(signal=>!verifiedHorizon(signal,Date.now())))throw new Error("Horizon evidence unavailable");
    return this.refreshes.finish(operationId,Date.now(),()=>{
      if(!signals.length)return 0;
      // Retain still-verified kinds omitted by this read. Never refresh their
      // verification date or keep a stale/seed claim as newly sourced news.
      const kinds=new Set(signals.map(signal=>signal.kind));
      for(const old of this.readSignals())if(kinds.has(old.kind)||!verifiedHorizon(old,Date.now()))this.sql.exec("DELETE FROM signals WHERE id=?",old.id);
      for(const signal of signals)this.insert({...signal,seeded:false});
      return signals.length;
    });
  }

  private loadSeed(fieldId: string): void {
    const field = seed.fields.find((f) => f.id === fieldId);
    if (!field) return;
    // When the seed was first read stays its date; the screens say "seed", not how old.
    const now = this.sql.exec<{ at: number | null }>("SELECT MIN(at) AS at FROM signals").one().at ?? Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM signals");
      for (const s of field.signals as Omit<Signal, "at" | "seeded">[]) {
        if (s.sources.length > 0) this.insert({ ...s, at: now, seeded: true });
      }
    });
  }

  private insert(s: Signal): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO signals (id, kind, text, timing, direction, sources, at, stays_human, seeded,verification) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?)",
      s.id,
      s.kind,
      s.text,
      s.timing ?? null,
      s.direction ?? null,
      JSON.stringify(s.sources),
      s.at,
      s.staysHuman ?? null,
      s.seeded ? 1 : 0,
      s.verification?JSON.stringify(s.verification):null,
    );
  }

  private onlySeed(): boolean {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM signals WHERE seeded = 0").one().n === 0;
  }

  private count(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM signals").one().n;
  }

}
