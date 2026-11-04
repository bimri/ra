import type { CrewKind } from "@ra/core";
import type { Env } from "../env";

export type PeopleProjection =
  | { kind: "intro"; ref: string; revision: number; state: "absent" }
  | { kind: "intro"; ref: string; revision: number; state: "pending" | "answered" | "crew"; name: string; beacon: string; crewKind: CrewKind; contact: string | null; sharedContact: string | null }
  | { kind: "witness"; ref: string; revision: number; state: "absent" | "saw" | "not-yet" }
  | { kind: "witness"; ref: string; revision: number; state: "asked"; name: string; text: string }
  | { kind: "witness"; ref: string; revision: number; state: "confirmed"; landfallId: string; name: string };

/** Include these statements in the same D1 batch as the authoritative mutation. */
export function queuePeople(env: Env, kind: "intro" | "witness", ref: string, accounts: string[]): D1PreparedStatement[] {
  return [...new Set(accounts)].map((account) => env.DB.prepare(
    "INSERT INTO people_jobs(account, kind, ref) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM people_erased WHERE account = ?) ON CONFLICT(account, kind, ref) DO UPDATE SET revision = revision + 1",
  ).bind(account, kind, ref, account));
}

export async function erased(env: Env, account: string): Promise<boolean> {
  return !!await env.DB.prepare("SELECT 1 FROM people_erased WHERE account = ?").bind(account).first();
}

export async function areCrew(env: Env, x: string, y: string): Promise<boolean> {
  const [a, b] = x < y ? [x, y] : [y, x];
  return !!await env.DB.prepare(`SELECT 1 FROM crew WHERE a = ? AND b = ?
    AND NOT EXISTS (SELECT 1 FROM blocks WHERE (account = ? AND blocked = ?) OR (account = ? AND blocked = ?))
    AND NOT EXISTS (SELECT 1 FROM people_erased WHERE account IN (?, ?))`).bind(a, b, a, b, b, a, a, b).first();
}

type Job = { account: string; kind: "intro" | "witness"; ref: string; revision: number };

async function projection(env: Env, job: Job): Promise<PeopleProjection> {
  const { account, kind, ref, revision } = job;
  if (kind === "intro") {
    const absent: PeopleProjection = { kind, ref, revision, state: "absent" };
    const intro = await env.DB.prepare("SELECT a,b,state,kind,expires_at FROM intros WHERE id = ?").bind(ref).first<{ a: string; b: string; state: string; kind: CrewKind; expires_at: number }>();
    if (!intro || ![intro.a, intro.b].includes(account)) return absent;
    const other = intro.a === account ? intro.b : intro.a;
    if (await erased(env, other)) return absent;
    if (await env.DB.prepare("SELECT 1 FROM blocks WHERE (account = ? AND blocked = ?) OR (account = ? AND blocked = ?)").bind(account, other, other, account).first()) return absent;
    if (["declined", "expired"].includes(intro.state) || (intro.state !== "introduced" && intro.expires_at <= Date.now())) return absent;
    // The second person must not see an introduction before the first yes.
    if (intro.state === "asked-a" && account === intro.b) return absent;
    if (intro.state === "introduced" && !await areCrew(env, account, other)) return absent;
    const beacon = await env.DB.prepare("SELECT name,text FROM beacons WHERE account = ?").bind(other).first<{ name: string; text: string }>();
    if (!beacon) return absent;
    const received = intro.state === "introduced" ? await env.DB.prepare("SELECT value FROM crew_contacts WHERE owner = ? AND recipient = ? AND intro_id = ?").bind(other,account,ref).first<{ value: string }>() : null;
    const shared = intro.state === "introduced" ? await env.DB.prepare("SELECT value FROM crew_contacts WHERE owner = ? AND recipient = ? AND intro_id = ?").bind(account,other,ref).first<{ value: string }>() : null;
    return { contact: received?.value ?? null, sharedContact: shared?.value ?? null, kind, ref, revision, state: intro.state === "introduced" ? "crew" : intro.state === "asked-b" && account === intro.a ? "answered" : "pending", name: beacon.name, beacon: beacon.text, crewKind: intro.kind };
  }
  const absent: PeopleProjection = { kind, ref, revision, state: "absent" };
  const request = await env.DB.prepare("SELECT owner,witness,landfall_id,state,summary FROM witness_requests WHERE id = ?").bind(ref).first<{ owner: string; witness: string; landfall_id: string; state: string; summary: string }>();
  if (!request || ![request.owner, request.witness].includes(account) || !await areCrew(env, request.owner, request.witness)) return absent;
  if (account === request.owner) {
    if (request.state !== "saw") return absent;
    const beacon = await env.DB.prepare("SELECT name FROM beacons WHERE account = ?").bind(request.witness).first<{ name: string }>();
    return { kind, ref, revision, state: "confirmed", landfallId: request.landfall_id, name: beacon?.name ?? "A crewmate" };
  }
  if (request.state === "asked") {
    const beacon = await env.DB.prepare("SELECT name FROM beacons WHERE account = ?").bind(request.owner).first<{ name: string }>();
    return { kind, ref, revision, state: "asked", name: beacon?.name ?? "A crewmate", text: request.summary };
  }
  return request.state === "saw" || request.state === "not-yet" ? { kind, ref, revision, state: request.state } : absent;
}

/** Retried on sync and after actions, even when the originating account has gone. */
export async function reconcilePeople(env: Env, account: string): Promise<{ pending: number }> {
  if (await erased(env, account)) return { pending: 0 };
  const expired = (await env.DB.prepare("SELECT id,a,b FROM intros WHERE state IN ('asked-a','asked-b') AND expires_at <= ? AND (a = ? OR b = ?) LIMIT 64").bind(Date.now(),account,account).all<{ id: string; a: string; b: string }>()).results;
  for (const intro of expired) await env.DB.batch([
    env.DB.prepare("UPDATE intros SET state = 'expired' WHERE id = ? AND state IN ('asked-a','asked-b') AND expires_at <= ?").bind(intro.id,Date.now()),
    ...queuePeople(env,"intro",intro.id,[intro.a,intro.b]),
  ]);
  const jobs = (await env.DB.prepare("SELECT account,kind,ref,revision FROM people_jobs WHERE account = ? AND revision > delivered ORDER BY revision,kind,ref LIMIT 64").bind(account).all<Job>()).results;
  let pending = 0;
  for (const job of jobs) {
    try {
      await env.MIND.getByName(account).peopleProjection(await projection(env, job));
      await env.DB.prepare("UPDATE people_jobs SET delivered = ? WHERE account = ? AND kind = ? AND ref = ? AND revision = ?").bind(job.revision, account, job.kind, job.ref, job.revision).run();
    } catch {
      pending++;
      // Do not log beacon text, witness text, names or account identifiers.
      console.warn(JSON.stringify({ ra: "people-reconciliation", kind: job.kind, deferred: true }));
    }
  }
  return { pending };
}
