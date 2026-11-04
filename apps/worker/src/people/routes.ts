import { areCrew, erased, queuePeople, reconcilePeople } from "./reconcile";
import { makeId, type ShareItem } from "@ra/core";
import type { Env } from "../env";
import { answerIntro, INTRO_DAYS, type Beacon, type IntroState } from "./match";

// Layer 3 routes. D1 holds only what someone made findable; everything about
// a person stays in their Mind, which hears about introductions, crews and
// witnesses as events.

const DAY = 86_400_000;
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });
const bad = (msg: string, status = 400) => new Response(msg, { status });

import { embed } from "../embeddings";

/** Under 18 at sign-up. Dev Minds without an account count as adults. */
async function minor(env: Env, account: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT age_bracket FROM accounts WHERE id = ?").bind(account).first<{ age_bracket: string }>();
  return !!row && row.age_bracket !== "adult";
}

/** The other person in an introduction you're part of, or null. */
async function otherIn(env: Env, introId: string, me: string): Promise<{ other: string; side: "a" | "b"; state: IntroState; kind: string; expiresAt: number; answer: number | null } | null> {
  const row = await env.DB.prepare("SELECT a, b, state, kind, expires_at, a_answer, b_answer FROM intros WHERE id = ?").bind(introId).first<{ a: string; b: string; state: IntroState; kind: string; expires_at: number; a_answer: number | null; b_answer: number | null }>();
  if (!row || (row.a !== me && row.b !== me)) return null;
  const state = row.state;
  return { other: row.a === me ? row.b : row.a, side: row.a === me ? "a" : "b", state, kind: row.kind, expiresAt: row.expires_at, answer: row.a === me ? row.a_answer : row.b_answer };
}

const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];

const shareCrew = areCrew;

export async function beaconRow(env: Env, account: string): Promise<Beacon | null> {
  const r = await env.DB.prepare("SELECT * FROM beacons WHERE account = ? AND lit = 1").bind(account).first<Record<string, unknown>>();
  return r ? toBeacon(r) : null;
}

export function toBeacon(r: Record<string, unknown>): Beacon {
  return {
    account: String(r.account),
    name: String(r.name),
    text: String(r.text),
    star: String(r.star),
    island: r.island ? String(r.island) : null,
    minor: r.minor === 1,
    landfalls: Number(r.landfalls ?? 0),
    starVec: r.star_vec ? (JSON.parse(String(r.star_vec)) as number[]) : null,
    islandVec: r.island_vec ? (JSON.parse(String(r.island_vec)) as number[]) : null,
  };
}

/** /people/beacon, /intro, /witness/*, /share, /block: yours, through your session. (Their screens have the bare names.) */
export async function people(request: Request, env: Env, path: string, who: string): Promise<Response | null> {
  const mind = env.MIND.getByName(who);
  if (!path.startsWith("/people/")) return null;
  if (await erased(env, who)) return bad("no such account", 404);
  const body = request.method === "POST" || request.method === "DELETE" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};

  // H1 · light, change or dim your beacon.
  if (path === "/people/beacon") {
    if (request.method === "DELETE") {
      await env.DB.prepare("UPDATE beacons SET lit = 0, updated_at = ? WHERE account = ?").bind(Date.now(), who).run();
      await mind.beaconDimmed();
      return new Response(null, { status: 204 });
    }
    const name = String(body.name ?? "").trim().slice(0, 40);
    const text = String(body.text ?? "").trim().slice(0, 280);
    const shines = body.shines === "star" ? "star" : "star+island";
    if (!name || !text) return bad("a name and your beacon's words are needed");
    const ctx = await mind.beaconContext();
    if (!ctx.star) return bad("a beacon shines your star; write it first (D2)");
    const island = shines === "star+island" ? ctx.island : null;
    const [starVec, islandVec] = await embed(env, [ctx.star, ...(island ? [island] : [])]);
    const changed = await env.DB.prepare(
      `INSERT INTO beacons (account, name, text, star, island, minor, landfalls, star_vec, island_vec, lit, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM people_erased WHERE account = ?)
       ON CONFLICT (account) DO UPDATE SET name = excluded.name, text = excluded.text, star = excluded.star, island = excluded.island,
         minor = excluded.minor, landfalls = excluded.landfalls, star_vec = excluded.star_vec, island_vec = excluded.island_vec, lit = 1, updated_at = excluded.updated_at`,
    )
      .bind(who, name, text, ctx.star, island, (await minor(env, who)) ? 1 : 0, ctx.landfalls, starVec ? JSON.stringify(starVec) : null, islandVec ? JSON.stringify(islandVec) : null, Date.now(), who)
      .run();
    if (!changed.meta.changes) return bad("no such account",404);
    await mind.beaconLit({ name, text, shines });
    await env.BEACON_MATCH.create({ params: { account: who } }).catch(() => null);
    return json({ shining: true });
  }

  // H2 · your answer to an introduction.
  if (path === "/people/intro" && request.method === "POST") {
    const introId = String(body.introId ?? "");
    const yes = body.yes === true;
    const it = await otherIn(env, introId, who);
    if (!it) return bad("no such introduction", 404);
    if (typeof body.yes !== "boolean") return bad("a yes or no is needed");
    if (it.answer !== null) {
      if (it.answer !== Number(yes)) return bad("already answered differently", 409);
      await reconcilePeople(env, who);
      await reconcilePeople(env, it.other);
      return json({ state: it.state });
    }
    if (it.expiresAt <= Date.now() || ["expired", "declined"].includes(it.state)) return bad("that introduction is no longer waiting", 410);
    const next = answerIntro(it.state, it.side, yes);
    if (next === it.state) return bad("not yours to answer now", 409);
    const [a, b] = pair(who, it.other);
    const answerColumn = it.side === "a" ? "a_answer" : "b_answer";
    const changes = await env.DB.batch([
      env.DB.prepare(`UPDATE intros SET state = ?, ${answerColumn} = ? WHERE id = ? AND state = ? AND expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM blocks WHERE (account = ? AND blocked = ?) OR (account = ? AND blocked = ?))
        AND NOT EXISTS (SELECT 1 FROM people_erased WHERE account IN (?, ?))`).bind(next, Number(yes), introId, it.state, Date.now(), a, b, b, a, a, b),
      env.DB.prepare("INSERT OR IGNORE INTO crew(a,b,intro_id,at) SELECT ?,?,?,? FROM intros WHERE id = ? AND state = 'introduced' AND NOT EXISTS (SELECT 1 FROM blocks WHERE (account = ? AND blocked = ?) OR (account = ? AND blocked = ?))").bind(a,b,introId,Date.now(),introId,a,b,b,a),
      ...queuePeople(env, "intro", introId, [who, it.other]),
    ]);
    if (!changes[0]?.meta.changes) return bad("introduction changed; sync and try again", 409);
    await reconcilePeople(env, who);
    await reconcilePeople(env, it.other);
    return json({ state: next });
  }

  // H3: contact sharing is per crewmate, after both yeses, and revocable.
  if (path === "/people/contact" && (request.method === "POST" || request.method === "DELETE")) {
    const introId = String(body.introId ?? "");
    const intro = await otherIn(env,introId,who);
    if (!intro || intro.state !== "introduced" || !await areCrew(env,who,intro.other)) return bad("not crew",403);
    const value = request.method === "DELETE" ? null : String(body.value ?? "").trim();
    if (value !== null) {
      if (!value || value.length > 240 || /[\r\n]/.test(value)) return bad("a contact link is needed");
      try { if (!["https:","mailto:","tel:"].includes(new URL(value).protocol)) return bad("use a web, email or phone link"); } catch { return bad("use a web, email or phone link"); }
    }
    await env.DB.batch([
      ...(value === null ? [env.DB.prepare("DELETE FROM crew_contacts WHERE owner = ? AND recipient = ?").bind(who,intro.other)] : [env.DB.prepare("INSERT INTO crew_contacts(owner,recipient,intro_id,value) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM crew WHERE intro_id = ?) AND NOT EXISTS (SELECT 1 FROM people_erased WHERE account IN (?,?)) ON CONFLICT(owner,recipient) DO UPDATE SET value = excluded.value,intro_id = excluded.intro_id").bind(who,intro.other,introId,value,introId,who,intro.other)]),
      ...queuePeople(env,"intro",introId,[who,intro.other]),
    ]);
    await reconcilePeople(env,who); await reconcilePeople(env,intro.other);
    return json({ shared: value !== null });
  }

  // G4 · ask crewmates to witness your landfall.
  if (path === "/people/witness/ask" && request.method === "POST") {
    const landfallId = String(body.landfallId ?? "");
    const text = String(body.text ?? "").trim().slice(0, 140);
    const introIds = Array.isArray(body.introIds) ? body.introIds.map(String).slice(0, 8) : [];
    if (!await mind.ownsLandfall(landfallId)) return bad("no such landfall", 404);
    let asked = 0;
    for (const introId of [...new Set(introIds)]) {
      const it = await otherIn(env, introId, who);
      if (!it || !await shareCrew(env, who, it.other)) continue;
      const rawId = new TextEncoder().encode(who + ":" + landfallId + ":" + it.other);
      const requestId = [...new Uint8Array(await crypto.subtle.digest("SHA-256", rawId))].map((v) => v.toString(16).padStart(2,"0")).join("");
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO witness_requests(id,owner,witness,landfall_id,state,at,summary) SELECT ?,?,?,?,'asked',?,? WHERE EXISTS (SELECT 1 FROM crew WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)) AND NOT EXISTS (SELECT 1 FROM people_erased WHERE account IN (?, ?))").bind(requestId,who,it.other,landfallId,Date.now(),text || "A landfall.",who,it.other,it.other,who,who,it.other),
        ...queuePeople(env,"witness",requestId,[who,it.other]),
      ]);
      await reconcilePeople(env, it.other);
      asked++;
    }
    return json({ asked });
  }

  // G4 · "I saw it" (or "Not yet") for a crewmate's landfall.
  if (path === "/people/witness/answer" && request.method === "POST") {
    const requestId = String(body.requestId ?? "");
    const saw = body.saw === true;
    const req = await env.DB.prepare("SELECT owner, witness, landfall_id, state FROM witness_requests WHERE id = ?").bind(requestId).first<{ owner: string; witness: string; landfall_id: string; state: string }>();
    if (!req || req.witness !== who) return bad("no such request", 404);
    // Proof without credentials: only a crewmate's word counts.
    if (!(await shareCrew(env, who, req.owner))) return bad("not crew", 403);
    if (typeof body.saw !== "boolean") return bad("a witness answer is needed");
    const answer = saw ? "saw" : "not-yet";
    if (req.state !== "asked" && req.state !== answer) return bad("already answered differently", 409);
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE witness_requests SET state = ? WHERE id = ? AND state = 'asked'").bind(answer,requestId),
      ...queuePeople(env,"witness",requestId,[who,req.owner]),
    ]);
    if (!results[0]?.meta.changes) {
      const current = await env.DB.prepare("SELECT state FROM witness_requests WHERE id = ?").bind(requestId).first<{ state: string }>();
      if (current?.state !== answer) return bad("already answered differently",409);
    }
    await reconcilePeople(env, who);
    await reconcilePeople(env, req.owner);
    return json({ saw });
  }

  // G5 · send a landfall postcard, or turn its link off.
  if (path === "/people/share") {
    if (request.method === "DELETE") {
      const token = String(body.token ?? "");
      const row = await env.DB.prepare("SELECT account FROM shares WHERE token = ?").bind(token).first<{ account: string }>();
      if (!row || row.account !== who) return bad("no such postcard", 404);
      await env.FILES.delete([`share/${token}.json`, `share/${token}.wav`]);
      await env.DB.prepare("DELETE FROM shares WHERE token = ?").bind(token).run();
      await mind.shareRevoked(token);
      return new Response(null, { status: 204 });
    }
    const landfallId = String(body.landfallId ?? "");
    const items = (Array.isArray(body.items) ? body.items : []).filter((i): i is ShareItem => ["markers", "voice", "star", "rings"].includes(String(i)));
    const note = String(body.note ?? "").trim().slice(0, 120);
    const snap = await mind.shareSnapshot(landfallId, items, note);
    if (!snap) return bad("no such landfall", 404);
    // A token nobody can guess: 128 random bits.
    const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.FILES.put(`share/${token}.json`, JSON.stringify({ ...snap.card, voice: !!snap.clip }), { httpMetadata: { contentType: "application/json" } });
    if (snap.clip) await env.FILES.put(`share/${token}.wav`, snap.clip, { httpMetadata: { contentType: "audio/wav" } });
    await env.DB.prepare("INSERT INTO shares (token, account, landfall_id, at) VALUES (?, ?, ?, ?)").bind(token, who, landfallId, Date.now()).run();
    await mind.shareMade({ token, landfallId, items });
    return json({ token, url: `/l/${token}` });
  }

  // Safety · block (and maybe report) someone Ra introduced, or a crewmate.
  if (path === "/people/block" && request.method === "POST") {
    const introId = String(body.introId ?? "");
    const it = await otherIn(env, introId, who);
    if (!it) return bad("no such person", 404);
    const theirs = await env.DB.prepare("SELECT name FROM beacons WHERE account = ?").bind(it.other).first<{ name: string }>();
    const [a, b] = pair(who, it.other);
    const relations = (await env.DB.prepare("SELECT id FROM intros WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)").bind(who,it.other,it.other,who).all<{ id: string }>()).results;
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO blocks(account,blocked,at) VALUES (?,?,?)").bind(who,it.other,Date.now()),
      env.DB.prepare("UPDATE intros SET state = 'declined' WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)").bind(a,b,b,a),
      env.DB.prepare("DELETE FROM crew WHERE a = ? AND b = ?").bind(a,b),
      env.DB.prepare("DELETE FROM crew_contacts WHERE (owner = ? AND recipient = ?) OR (owner = ? AND recipient = ?)").bind(a,b,b,a),
      env.DB.prepare("UPDATE witness_requests SET state = 'cancelled' WHERE (owner = ? AND witness = ?) OR (owner = ? AND witness = ?)").bind(who,it.other,it.other,who),
      ...relations.flatMap((r) => queuePeople(env,"intro",r.id,[who,it.other])),
      env.DB.prepare("INSERT INTO people_jobs(account,kind,ref) SELECT owner,'witness',id FROM witness_requests WHERE (owner = ? AND witness = ?) OR (owner = ? AND witness = ?) ON CONFLICT(account,kind,ref) DO UPDATE SET revision = revision + 1").bind(who,it.other,it.other,who),
      env.DB.prepare("INSERT INTO people_jobs(account,kind,ref) SELECT witness,'witness',id FROM witness_requests WHERE (owner = ? AND witness = ?) OR (owner = ? AND witness = ?) ON CONFLICT(account,kind,ref) DO UPDATE SET revision = revision + 1").bind(who,it.other,it.other,who),
      ...(body.report === true ? [env.DB.prepare("INSERT OR IGNORE INTO reports(id,reporter,about,intro_id,at) VALUES (?,?,?,?,?)").bind("report:" + who + ":" + introId,who,it.other,introId,Date.now())] : []),
    ]);
    await reconcilePeople(env, who);
    await reconcilePeople(env, it.other);
    await mind.personBlocked(theirs?.name ?? "Someone", body.report === true);
    return new Response(null, { status: 204 });
  }

  return null;
}

/** GET /l/:token.json and /l/:token.wav: a postcard is public by its owner's choice; nothing else is. */
export async function postcard(env: Env, path: string): Promise<Response | null> {
  const m = /^\/l\/([0-9a-f]{32})\.(json|wav)$/.exec(path);
  if (!m) return null;
  const obj = await env.FILES.get(`share/${m[1]}.${m[2]}`);
  if (!obj) return new Response("this postcard was taken down", { status: 404 });
  return new Response(obj.body, { headers: { "content-type": m[2] === "json" ? "application/json" : "audio/wav", "cache-control": "no-store" } });
}

/** BeaconMatch: one introduction at a time; Ra never pushes another while one waits. */
export async function matchFor(env: Env, account: string): Promise<{ introId: string; with: string } | null> {
  const { pickMatch } = await import("./match");
  const me = await beaconRow(env, account);
  if (!me) return null;
  const waiting = await env.DB.prepare("SELECT 1 FROM intros WHERE ((a = ? AND state = 'asked-a') OR (b = ? AND state = 'asked-b')) AND expires_at >= ?").bind(account, account, Date.now()).first();
  if (waiting) return null;
  const others = (await env.DB.prepare("SELECT * FROM beacons WHERE lit = 1 AND account != ?").bind(account).all<Record<string, unknown>>()).results.map(toBeacon);
  const excluded = new Set<string>();
  for (const r of (await env.DB.prepare("SELECT a, b FROM intros WHERE a = ? OR b = ?").bind(account, account).all<{ a: string; b: string }>()).results) excluded.add(r.a === account ? r.b : r.a);
  for (const r of (await env.DB.prepare("SELECT account, blocked FROM blocks WHERE account = ? OR blocked = ?").bind(account, account).all<{ account: string; blocked: string }>()).results) excluded.add(r.account === account ? r.blocked : r.account);
  const match = pickMatch(me, others, excluded);
  if (!match) return null;
  const introId = makeId();
  const other = match.them.account;
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO intros(id,a,b,kind,state,created_at,expires_at) SELECT ?,?,?,?,'asked-a',?,?
      WHERE NOT EXISTS (SELECT 1 FROM people_erased WHERE account IN (?,?))
      AND NOT EXISTS (SELECT 1 FROM blocks WHERE (account = ? AND blocked = ?) OR (account = ? AND blocked = ?))
      AND NOT EXISTS (SELECT 1 FROM intros WHERE state IN ('asked-a','asked-b') AND expires_at > ? AND (a IN (?,?) OR b IN (?,?)))
      AND (SELECT COUNT(*) FROM beacons WHERE account IN (?,?) AND lit = 1) = 2`).bind(introId,account,other,match.kind,Date.now(),Date.now()+INTRO_DAYS*DAY,account,other,account,other,other,account,Date.now(),account,other,account,other,account,other),
    ...queuePeople(env,"intro",introId,[account,other]),
  ]);
  if (!results[0]?.meta.changes) return null;
  await reconcilePeople(env, account);
  return { introId, with: match.them.account };
}

/**
 * DELETE /me: your beacon, introductions, crew, witness requests and
 * postcards go with you. Reports others made about you stay, for safety.
 */
export async function forgetPerson(env: Env, account: string): Promise<void> {
  // Revoke before reading relationships so concurrent transitions cannot recreate them.
  await env.DB.prepare("INSERT OR IGNORE INTO people_erased(account) VALUES (?)").bind(account).run();
  const relations = (await env.DB.prepare("SELECT id,a,b FROM intros WHERE a = ? OR b = ?").bind(account,account).all<{ id: string; a: string; b: string }>()).results;
  const requests = (await env.DB.prepare("SELECT id,owner,witness FROM witness_requests WHERE owner = ? OR witness = ?").bind(account,account).all<{ id: string; owner: string; witness: string }>()).results;
  const shares = (await env.DB.prepare("SELECT token FROM shares WHERE account = ?").bind(account).all<{ token: string }>()).results;
  if (shares.length) await env.FILES.delete(shares.flatMap((s) => [`share/${s.token}.json`, `share/${s.token}.wav`]));
  await env.DB.batch([
    ...relations.flatMap((r) => queuePeople(env,"intro",r.id,[r.a === account ? r.b : r.a])),
    ...requests.flatMap((r) => queuePeople(env,"witness",r.id,[r.owner === account ? r.witness : r.owner])),
    env.DB.prepare("DELETE FROM people_jobs WHERE account = ?").bind(account),
    env.DB.prepare("DELETE FROM crew_contacts WHERE owner = ? OR recipient = ?").bind(account,account),
    env.DB.prepare("DELETE FROM beacons WHERE account = ?").bind(account),
    env.DB.prepare("DELETE FROM intros WHERE a = ? OR b = ?").bind(account, account),
    env.DB.prepare("DELETE FROM crew WHERE a = ? OR b = ?").bind(account, account),
    env.DB.prepare("DELETE FROM witness_requests WHERE owner = ? OR witness = ?").bind(account, account),
    env.DB.prepare("DELETE FROM shares WHERE account = ?").bind(account),
    env.DB.prepare("DELETE FROM blocks WHERE account = ? OR blocked = ?").bind(account, account),
    env.DB.prepare("DELETE FROM reports WHERE reporter = ?").bind(account),
    env.DB.prepare("DELETE FROM ear_links WHERE account = ?").bind(account),
    env.DB.prepare("DELETE FROM ear_codes WHERE account = ?").bind(account),
      env.DB.prepare("DELETE FROM ear_accounts WHERE account = ?").bind(account),
      env.DB.prepare("UPDATE ear_operations SET account = NULL, generation = NULL, claim_token = '', processed = 1, reply_kind = NULL, reply_state = 'blocked', lease_token = NULL, lease_until = 0 WHERE account = ?").bind(account),
  ]);
  for (const other of new Set([...relations.map((r) => r.a === account ? r.b : r.a), ...requests.map((r) => r.owner === account ? r.witness : r.owner)])) await reconcilePeople(env,other);
}
