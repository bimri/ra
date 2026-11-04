import { makeId } from "@ra/core";
import type { Env } from "../env";
import { cosine } from "../people/match";
import { embed, validEmbedding } from "../embeddings";
import { publicOf, signClaim, tranches, validClaim, verifyClaim, type Claim } from "./claims";

// K1 · voyages and the money firewall. Everything here lives in LEDGER, its
// own database with no route to any Mind: a voyage belongs to a holder (a
// keyed hash of the account), never an account id, and funders learn of an
// arrival only as a signed claim the person chose to share.

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", "cache-control": "no-store", ...init.headers } });
const bad = (msg: string, status = 400) => new Response(msg, { status,headers:{"cache-control":"no-store"} });
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** A mission funder backs journeys whose star or island is close to its mission. */
export const FUNDER_FIT = 0.55;

/** The ledger's name for a person: only the Worker, holding the master key, can make it. */
export async function holderOf(env: Env, account: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`ra-ledger:${env.RA_MASTER_KEY ?? "dev"}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(account)));
}

const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

function ledgerKey(env: Env): JsonWebKey | null {
  try {
    return env.RA_LEDGER_KEY ? (JSON.parse(env.RA_LEDGER_KEY) as JsonWebKey) : null;
  } catch {
    return null;
  }
}

interface Funder {
  id: string;
  name: string;
  mission: string;
  mission_vec: string | null;
  budget_cents: number;
  upfront: number;
  grant_cents: number;
  currency: string;
}

/** The funder whose mission is closest to your star or island, with budget left. */
async function funderFor(env: Env, star: string, island: string): Promise<Funder | null> {
  const funders = (await env.LEDGER.prepare("SELECT id, name, mission, mission_vec, budget_cents, upfront, grant_cents, currency FROM funders WHERE terms_configured = 1 AND grant_cents > 0 AND budget_cents >= grant_cents AND currency IS NOT NULL").all<Funder>()).results;
  if (!funders.length) return null;
  const [starVec, islandVec] = await embed(env, [star, island]);
  let best: { f: Funder; score: number } | null = null;
  for (const f of funders) {
    if (!Number.isSafeInteger(f.grant_cents) || f.grant_cents <= 0 || !Number.isFinite(f.upfront) || f.upfront < 0 || f.upfront > 1 || !/^[A-Z]{3}$/.test(f.currency)) continue;
    let v: unknown;
    try { v = f.mission_vec ? JSON.parse(f.mission_vec) : null; } catch { continue; }
    if (!validEmbedding(v) || !starVec || !Number.isSafeInteger(f.budget_cents)) continue;
    const score = Math.max(cosine(starVec, v), islandVec ? cosine(islandVec, v) : 0);
    if (score >= FUNDER_FIT && (!best || score > best.score || score === best.score && f.id < best.f.id)) best = { f, score };
  }
  return best?.f ?? null;
}

interface VoyageRow {
  id: string; holder: string; island: string; markers: number; marker_refs: string | null;
  funder_id: string | null; funder_name: string | null; funder_mission: string | null;
  amount_cents: number | null; currency: string | null; upfront: number | null;
  upfront_cents: number | null; marker_cents: number | null; landfall_cents: number | null;
  terms_version: number; reserved: number; started_at: number;
}
const readVoyage = (env: Env, id: string) => env.LEDGER.prepare("SELECT * FROM voyages WHERE id = ?").bind(id).first<VoyageRow>();
const erasedHolder = async (env: Env, holder: string) => !!await env.LEDGER.prepare("SELECT 1 FROM erased_holders WHERE holder = ?").bind(holder).first();

/** Remove private words and ownership links without rewriting financial amounts. */
export async function forgetLedger(env: Env, who: string): Promise<void> {
  const holder = await holderOf(env,who);
  await env.LEDGER.batch([
    env.LEDGER.prepare("INSERT OR IGNORE INTO erased_holders(holder,at) VALUES (?,?)").bind(holder,Date.now()),
    env.LEDGER.prepare("DELETE FROM claims WHERE voyage_id IN (SELECT id FROM voyages WHERE holder = ?)").bind(holder),
    env.LEDGER.prepare("UPDATE payments SET payer = 'erased:' || id WHERE payer = ?").bind('holder:'+holder),
    env.LEDGER.prepare("UPDATE voyages SET holder = 'erased:' || id,island = 'erased:' || id,marker_refs = NULL,mind_delivered = 1,state = 'closed' WHERE holder = ?").bind(holder),
    env.LEDGER.prepare("UPDATE pledges SET holder = 'erased:' || id,mind_delivered = 1 WHERE holder = ?").bind(holder),
  ]);
}
const validMoney = (amount: unknown, currency: unknown): boolean => typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 && typeof currency === "string" && /^[A-Z]{3}$/.test(currency);
function explicitTerms(v: VoyageRow): boolean {
  if (v.terms_version !== 1 || v.reserved !== 1 || !validMoney(v.amount_cents, v.currency) || !Number.isSafeInteger(v.markers) || v.markers < 1) return false;
  if (!v.funder_id) return true;
  if (!v.funder_name || !v.funder_mission || v.upfront === null) return false;
  try {
    const t = tranches(v.amount_cents!, v.upfront, v.markers);
    return t.upfront === v.upfront_cents && t.perMarker === v.marker_cents && t.landfall === v.landfall_cents;
  } catch { return false; }
}

/** Reconcile a missing pending obligation; never overwrite a settled or conflicting one. */
async function obligation(env: Env, v: VoyageRow, id: string, kind: string, amount: number, at: number): Promise<boolean> {
  const payer = v.funder_id ? `funder:${v.funder_id}` : `holder:${v.holder}`;
  await env.LEDGER.prepare("INSERT OR IGNORE INTO payments (id,voyage_id,payer,kind,amount_cents,currency,state,at) VALUES (?,?,?,?,?,?,'pending',?)").bind(id,v.id,payer,kind,amount,v.currency,at).run();
  const row = await env.LEDGER.prepare("SELECT voyage_id,payer,kind,amount_cents,currency FROM payments WHERE id = ?").bind(id).first<{voyage_id:string;payer:string;kind:string;amount_cents:number;currency:string}>();
  return !!row && row.voyage_id === v.id && row.payer === payer && row.kind === kind && row.amount_cents === amount && row.currency === v.currency;
}

async function deliverStart(env: Env, v: VoyageRow, who: string): Promise<Response> {
  if (await erasedHolder(env,v.holder)) return bad("no such account",404);
  if (!explicitTerms(v)) return bad("legacy voyage terms need explicit reconciliation",409);
  let markerIds: string[];
  try { markerIds = JSON.parse(v.marker_refs ?? "null"); } catch { return bad("voyage markers need reconciliation",409); }
  if (!Array.isArray(markerIds) || markerIds.length !== v.markers || markerIds.some(id => typeof id !== "string" || !id) || new Set(markerIds).size !== markerIds.length) return bad("voyage markers need reconciliation",409);
  if (!await obligation(env,v,(v.funder_id ? "upfront:" : "price:")+v.id,v.funder_id ? "upfront" : "price",v.funder_id ? v.upfront_cents! : v.amount_cents!,v.started_at)) return bad("voyage payment needs reconciliation",409);
  await env.MIND.getByName(who).voyageStarted({ voyageId:v.id,island:v.island,markerIds,startedAt:v.started_at,funder:v.funder_id ? {name:v.funder_name!,mission:v.funder_mission!} : null,price:v.funder_id ? null : {amountCents:v.amount_cents!,currency:v.currency!} });
  await env.LEDGER.prepare("UPDATE voyages SET mind_delivered = 1 WHERE id = ?").bind(v.id).run();
  return json({voyageId:v.id});
}

async function deliverClaim(env: Env, v: VoyageRow, slot: string, who: string): Promise<Response> {
  if (await erasedHolder(env,v.holder)) return bad("no such account",404);
  if (!explicitTerms(v)) return bad("legacy voyage terms need explicit reconciliation",409);
  const markerIndex = /^marker:\d+$/.test(slot) ? Number(slot.slice(7)) : undefined;
  if (slot !== "landfall" && (markerIndex === undefined || !Number.isSafeInteger(markerIndex) || markerIndex >= v.markers)) return bad("claim needs reconciliation",409);
  const kind = slot === "landfall" ? "landfall" : "marker";
  const stored = await env.LEDGER.prepare("SELECT payload,signature FROM claims WHERE voyage_id = ? AND slot = ?").bind(v.id,slot).first<{payload:string;signature:string}>();
  let canonical: unknown; try { canonical = JSON.parse(stored?.payload ?? "null"); } catch { return bad("claim needs reconciliation",409); }
  if (!stored || !validClaim(canonical) || canonical.v !== 2 || canonical.voyage !== v.id || canonical.kind !== kind) return bad("claim needs reconciliation",409);
  if (v.funder_id && !await obligation(env,v,"payment:"+canonical.milestone,kind,kind === "landfall" ? v.landfall_cents! : v.marker_cents!,canonical.at)) return bad("claim payment needs reconciliation",409);
  if (kind === "landfall") await env.LEDGER.prepare("UPDATE voyages SET state = 'landed', closed_at = COALESCE(closed_at, ?) WHERE id = ?").bind(canonical.at,v.id).run();
  await env.MIND.getByName(who).voyageClaimed(v.id,kind,canonical.milestone,markerIndex);
  await env.LEDGER.prepare("UPDATE claims SET mind_delivered = 1 WHERE voyage_id = ? AND slot = ?").bind(v.id,slot).run();
  return json({claim:canonical,signature:stored.signature});
}

/** Drain only this signed-in holder's previously authorized work, in bounded batches. */
export async function recoverLedger(env: Env, who: string): Promise<{delivered:number;deferred:number}> {
  const holder = await holderOf(env,who), result={delivered:0,deferred:0};
  if (await erasedHolder(env,holder)) return result;
  const now=Date.now();
  const attempt = async (table:"voyages"|"claims"|"pledges",id:string,run:()=>Promise<Response>) => {
    try { if ((await run()).ok) {result.delivered++;return;} } catch { /* Keep the authorized receipt queued. */ }
    result.deferred++;
    await env.LEDGER.prepare(`UPDATE ${table} SET retry_at = ? + MIN(3600000,60000 * (1 << MIN(delivery_attempts,6))),delivery_attempts = MIN(delivery_attempts+1,7) WHERE id = ? AND mind_delivered = 0`).bind(now,id).run();
  };
  const starts = (await env.LEDGER.prepare("SELECT * FROM voyages WHERE holder = ? AND terms_version = 1 AND mind_delivered = 0 AND retry_at <= ? ORDER BY started_at,id LIMIT 8").bind(holder,now).all<VoyageRow>()).results;
  for (const v of starts) await attempt("voyages",v.id,()=>deliverStart(env,v,who));
  const claims = (await env.LEDGER.prepare("SELECT c.id,c.voyage_id,c.slot FROM claims c JOIN voyages v ON v.id=c.voyage_id WHERE v.holder = ? AND v.terms_version = 1 AND c.slot IS NOT NULL AND c.mind_delivered = 0 AND c.retry_at <= ? ORDER BY c.at,c.id LIMIT 8").bind(holder,now).all<{id:string;voyage_id:string;slot:string}>()).results;
  for (const claim of claims) await attempt("claims",claim.id,async()=>{const v=await readVoyage(env,claim.voyage_id);return v?.holder===holder ? deliverClaim(env,v,claim.slot,who) : bad("no such voyage",404)});
  const pledges = (await env.LEDGER.prepare("SELECT id,amount_cents,currency FROM pledges WHERE holder = ? AND mind_delivered = 0 AND retry_at <= ? ORDER BY at,id LIMIT 8").bind(holder,now).all<{id:string;amount_cents:number;currency:string}>()).results;
  for (const p of pledges) await attempt("pledges",p.id,async()=>{
    if (!validMoney(p.amount_cents,p.currency)) return bad("pledge needs reconciliation",409);
    await env.MIND.getByName(who).pledged(p.amount_cents,p.currency,p.id);
    await env.LEDGER.prepare("UPDATE pledges SET mind_delivered = 1 WHERE id = ?").bind(p.id).run();
    return json({pledged:true,paid:false});
  });
  return result;
}

/** /voyage, /voyage/claim, /voyage/forward: yours, through your session. */
export async function voyage(request: Request, env: Env, path: string, who: string): Promise<Response | null> {
  if (!path.startsWith("/voyage")) return null;
  const mind = env.MIND.getByName(who);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const holder = await holderOf(env, who);
  if (await erasedHolder(env,holder)) return bad("no such account",404);

  // K1 · start a voyage to your next island.
  if (path === "/voyage" && request.method === "POST") {
    const ctx = await mind.voyageContext();
    if (!ctx.island || !ctx.star || !Number.isSafeInteger(ctx.markers) || ctx.markers<1) return bad("a voyage needs your star and an island with markers");
    const voyageId = ctx.open ?? await sha256(holder + ":" + ctx.island);
    const previous = await readVoyage(env,voyageId);
    if (previous) {
      if (previous.holder !== holder) return bad("no such voyage",404);
      return deliverStart(env,previous,who);
    }
    if (ctx.open) return bad("voyage ledger needs reconciliation",409);
    if (!Array.isArray(ctx.markerIds) || ctx.markerIds.length !== ctx.markers || new Set(ctx.markerIds).size !== ctx.markers) return bad("voyage markers need reconciliation",409);
    const funder = await funderFor(env, ctx.star, ctx.island);
    const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
    const price = !funder && country ? await env.LEDGER.prepare("SELECT amount_cents, currency FROM prices WHERE country = ?").bind(country).first<{ amount_cents: number; currency: string }>() : null;
    // A funded voyage is worth the funder's grant, a share of their budget; the rest pays out as markers are reached.
    if (!funder && (!price || !validMoney(price.amount_cents,price.currency))) return bad("voyage terms have not been configured", 503);
    const grant = funder?.grant_cents ?? null;
    const t = funder ? tranches(grant!,funder.upfront,ctx.markers) : null;
    const now = Date.now();
    const stmts = [
      env.LEDGER.prepare(`INSERT OR IGNORE INTO voyages (id,holder,island,markers,funder_id,amount_cents,currency,state,started_at,upfront,marker_refs,terms_version,funder_name,funder_mission,upfront_cents,marker_cents,landfall_cents,reserved)
        SELECT ?,?,?,?,?,?,?,'open',?,?,?,1,?,?,?,?,?,0 WHERE (? IS NOT NULL AND EXISTS
        (SELECT 1 FROM funders WHERE id = ? AND terms_configured = 1 AND budget_cents >= ? AND grant_cents = ? AND currency = ? AND upfront = ? AND name = ? AND mission = ?))
        OR (? IS NULL AND EXISTS (SELECT 1 FROM prices WHERE country = ? AND amount_cents = ? AND currency = ?))` ).bind(
        voyageId,
        holder,
        ctx.island,
        ctx.markers,
        funder?.id ?? null,
        grant ?? price?.amount_cents ?? null,
        funder ? funder.currency : (price?.currency ?? null),
        now, funder?.upfront ?? null, JSON.stringify(ctx.markerIds),funder?.name ?? null,funder?.mission ?? null,t?.upfront ?? null,t?.perMarker ?? null,t?.landfall ?? null,
        funder?.id ?? null,funder?.id ?? null,grant ?? 0,grant ?? 0,funder?.currency ?? null,funder?.upfront ?? null,funder?.name ?? null,funder?.mission ?? null,
        funder?.id ?? null,country,price?.amount_cents ?? null,price?.currency ?? null,
      ),
    ];
    // Every statement uses the winning row, including when this request lost INSERT OR IGNORE.
    stmts.push(env.LEDGER.prepare(`UPDATE funders SET budget_cents = budget_cents - (SELECT amount_cents FROM voyages WHERE id = ?)
      WHERE id = (SELECT funder_id FROM voyages WHERE id = ? AND reserved = 0 AND terms_version = 1)
      AND budget_cents >= (SELECT amount_cents FROM voyages WHERE id = ?)` ).bind(voyageId,voyageId,voyageId));
    stmts.push(env.LEDGER.prepare(`INSERT OR IGNORE INTO payments(id,voyage_id,payer,kind,amount_cents,currency,state,at)
      SELECT CASE WHEN funder_id IS NULL THEN 'price:' ELSE 'upfront:' END || id,id,
      CASE WHEN funder_id IS NULL THEN 'holder:' || holder ELSE 'funder:' || funder_id END,
      CASE WHEN funder_id IS NULL THEN 'price' ELSE 'upfront' END,
      CASE WHEN funder_id IS NULL THEN amount_cents ELSE upfront_cents END,currency,'pending',started_at FROM voyages WHERE id = ? AND terms_version = 1` ).bind(voyageId));
    stmts.push(env.LEDGER.prepare("UPDATE voyages SET reserved = 1 WHERE id = ? AND terms_version = 1").bind(voyageId));
    await env.LEDGER.batch(stmts);
    const committed = await readVoyage(env,voyageId);
    if (!committed || committed.holder !== holder) return bad("funding changed; try again",409);
    return deliverStart(env,committed,who);
  }

  // K1 · share an arrival with your funder: a signed claim, nothing more.
  if (path === "/voyage/claim" && request.method === "POST") {
    const voyageId = String(body.voyageId ?? "");
    if (body.kind !== "marker" && body.kind !== "landfall") return bad("an achievement kind is needed");
    const kind = body.kind;
    if (kind === "marker" && !Number.isInteger(body.markerIndex)) return bad("a marker index is needed");
    const v = await readVoyage(env,voyageId);
    if (!v || v.holder !== holder) return bad("no such voyage", 404);
    if (kind === "marker" && (Number(body.markerIndex) < 0 || Number(body.markerIndex) >= v.markers)) return bad("no such marker",400);
    const key = ledgerKey(env);
    if (!key) return bad("claims can't be signed yet (RA_LEDGER_KEY)", 503);
    const achievement = await mind.voyageAchievement(v.id, kind === "marker" ? Number(body.markerIndex) : undefined);
    if (!achievement) return bad("that achievement has not been recorded", 409);
    if (!explicitTerms(v)) return bad("legacy voyage terms need explicit reconciliation",409);
    const milestone = await sha256(v.id + ":" + achievement.ref);
    const claimId = "claim:" + milestone;
    const slot = kind === "marker" ? "marker:"+body.markerIndex : "landfall";
    // We cannot infer which marker an old, unindexed disclosure paid for.
    // Only an exact retry may bind that old receipt; other requests need review.
    if (await env.LEDGER.prepare("SELECT 1 FROM claims WHERE voyage_id = ? AND kind = ? AND slot IS NULL AND id != ?").bind(v.id,kind,claimId).first()) return bad("legacy claims need explicit reconciliation",409);
    const claim: Claim = { v: 2, voyage: v.id, kind, milestone, at: achievement.at };
    const signature = await signClaim(claim, key);
    const old = await env.LEDGER.prepare("SELECT payload FROM claims WHERE id = ? AND slot IS NULL").bind(claimId).first<{payload:string}>();
    if (old) {
      let parsed: unknown; try { parsed = JSON.parse(old.payload); } catch { return bad("claim needs reconciliation",409); }
      if (!validClaim(parsed) || parsed.v !== 2 || parsed.voyage !== v.id || parsed.kind !== kind || parsed.milestone !== milestone || parsed.at !== claim.at) return bad("claim needs reconciliation",409);
    }
    await env.LEDGER.batch([
      env.LEDGER.prepare("UPDATE OR IGNORE claims SET slot = ? WHERE id = ? AND voyage_id = ? AND slot IS NULL").bind(slot,claimId,v.id),
      env.LEDGER.prepare("INSERT OR IGNORE INTO claims (id,voyage_id,funder_id,kind,payload,signature,at,slot) VALUES (?,?,?,?,?,?,?,?)").bind(claimId,v.id,v.funder_id,kind,JSON.stringify(claim),signature,claim.at,slot),
    ]);
    return deliverClaim(env,v,slot,who);
  }

  // Pay it forward: a pledge toward someone else's voyage, from someone who arrived.
  if (path === "/voyage/forward" && request.method === "POST") {
    if (!(await mind.beaconContext()).landfalls) return bad("paying forward follows a landfall", 409);
    const amountCents = body.amountCents;
    const currency = String(body.currency ?? "");
    const operationId = String(body.operationId ?? "");
    if (typeof amountCents !== "number" || !validMoney(amountCents,currency) || !/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) return bad("an amount, currency and operation id are needed");
    const pledgeId = await sha256(holder + ":pledge:" + operationId);
    const existing = await env.LEDGER.prepare("SELECT amount_cents, currency FROM pledges WHERE id = ?").bind(pledgeId).first<{ amount_cents: number; currency: string }>();
    if (existing && (existing.amount_cents !== amountCents || existing.currency !== currency)) return bad("that pledge has different terms", 409);
    await env.LEDGER.prepare("INSERT OR IGNORE INTO pledges (id, holder, amount_cents, currency, state, at) VALUES (?, ?, ?, ?, 'pledged', ?)").bind(pledgeId, holder, amountCents, currency, Date.now()).run();
    const committed = await env.LEDGER.prepare("SELECT holder,amount_cents,currency FROM pledges WHERE id = ?").bind(pledgeId).first<{holder:string;amount_cents:number;currency:string}>();
    if (!committed || committed.holder !== holder || committed.amount_cents !== amountCents || committed.currency !== currency) return bad("that pledge has different terms",409);
    await mind.pledged(committed.amount_cents,committed.currency,pledgeId);
    await env.LEDGER.prepare("UPDATE pledges SET mind_delivered = 1 WHERE id = ?").bind(pledgeId).run();
    // No payment provider yet: the pledge is recorded, and paid once one is onboarded.
    return json({ pledged: true, paid: false });
  }

  return null;
}

/**
 * The funder side, kept on the ledger. A funder sees only its claims: which
 * voyage (an opaque id), what kind, when, and the signature. Never a mind,
 * never a route.
 */
export async function funders(request: Request, env: Env, path: string): Promise<Response | null> {
  if (!path.startsWith("/funders/")) return null;
  const key = ledgerKey(env);
  if (path === "/funders/key") return json({ alg: "Ed25519", key: key ? publicOf(key) : null });
  if (path === "/funders/verify" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { claim?: Claim; signature?: string } | null;
    if (!body?.claim || !body.signature || !key) return bad("a claim and its signature are needed");
    return json({ valid: await verifyClaim(body.claim, body.signature, publicOf(key)) });
  }
  if (path === "/funders/claims") {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const funder = token ? await env.LEDGER.prepare("SELECT id FROM funders WHERE token_hash = ?").bind(await sha256(token)).first<{ id: string }>() : null;
    if (!funder) return bad("unknown funder", 401);
    const rows = (await env.LEDGER.prepare("SELECT payload, signature FROM claims WHERE funder_id = ? ORDER BY at DESC LIMIT 200").bind(funder.id).all<{ payload: string; signature: string }>()).results;
    return json({ claims: rows.flatMap(r => {
      try { const claim: unknown = JSON.parse(r.payload); return validClaim(claim) && claim.v === 2 ? [{claim,signature:r.signature}] : []; } catch { return []; }
    }) });
  }
  return null;
}

/** Dev: a mission funder, from the K1 board's own words. Returns its API token once. */
export async function devFunder(env: Env, input: { name?: string; mission?: string; budgetCents?: number; grantCents?: number; currency?: string; upfront?: number }): Promise<{ id: string; token: string }> {
  if (input.budgetCents !== undefined && (!Number.isSafeInteger(input.budgetCents) || input.budgetCents < 0)) throw new Error("A non-negative integer budget is required");
  const id = makeId();
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const mission = input.mission ?? "Backs journeys toward reliable power.";
  const [vec] = await embed(env, [mission]);
  const configured = Number.isSafeInteger(input.grantCents) && Number(input.grantCents) > 0 && /^[A-Z]{3}$/.test(input.currency ?? "") && Number.isFinite(input.upfront) && Number(input.upfront) >= 0 && Number(input.upfront) <= 1;
  await env.LEDGER.prepare("INSERT INTO funders (id, name, mission, mission_vec, token_hash, budget_cents, upfront, created_at, grant_cents, currency, terms_configured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, input.name ?? "A mission funder", mission, vec ? JSON.stringify(vec) : null, await sha256(token), input.budgetCents ?? 0, input.upfront ?? 0, Date.now(), configured ? input.grantCents : null, configured ? input.currency : null, configured ? 1 : 0)
    .run();
  return { id, token };
}
