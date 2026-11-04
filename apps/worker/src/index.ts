import { deliverArrivals } from "./people/arrivals";
import { accountMatches } from "./auth/account-bound";
import { ReviewedCaptureError,checkReviewedCapture } from "./mind/reviewedCapture";
import { reconcilePeople } from "./people/reconcile";
import type { Env } from "./env";
import {routeApi} from "./routeApi";
import { amani } from "./dev/amani";
import { earLink, earWebhook } from "./ear/receiver";
import {decodeEarAudio} from "./ear/media";
import earOpus from "./ear/codecs/opus.wasm";
import {reconcileEar} from "./ear/reconcile";
import { forgetPerson, people, postcard } from "./people/routes";
import { devFunder, forgetLedger, funders, recoverLedger, voyage } from "./ledger";
import {
  AuthError,
  eraseAccount,
  loginOptions,
  loginVerify,
  registerOptions,
  registerVerify,
  sessionAccount,
  signOutCookie,
} from "./auth/passkeys";
import { loginPassphrase, registerPassphrase } from "./auth/passphrase";
import { FIELDS } from "./horizon/HorizonDO";
import { transcribeClip } from "./transcribe";
import { museProbe } from "./muse/probe";
import { pcmOf } from "./transcribe/wav";
import { spokenCommand } from "@ra/core";

export { MindDO } from "./mind/MindDO";
export { HorizonDO } from "./horizon/HorizonDO";
export { TripDesign, HorizonRefresh, NightWatch, WeeklyReading, SeasonReview, BeaconMatch } from "./workflows";

const PERSON_RE = /^[a-z0-9-]{1,64}$/;

/**
 * Whose Mind this request reaches. A passkey session is the account. In dev
 * only, a person can also be named with ?person= (tests, and the Android
 * emulator before it has a passkey).
 */
async function person(request: Request, env: Env): Promise<string | null> {
  const signedIn = await sessionAccount(env, request);
  if (signedIn) return signedIn;
  if (env.RA_ENV !== "dev") return null;
  const url = new URL(request.url);
  const name = url.searchParams.get("person") ?? request.headers.get("x-ra-person") ?? "dev";
  return PERSON_RE.test(name) ? name : null;
}

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
const unauthorised = () => new Response("sign in first", { status: 401 });

/** Base64 of bytes, for handing a clip to the transcriber. */
function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function auth(request: Request, env: Env, path: string): Promise<Response> {
  try {
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    if (path === "/auth/passkey/register/options") return json(await registerOptions(env, request, body as never));
    if (path === "/auth/passkey/login/options") return json(await loginOptions(env, request));
    if (path === "/auth/passkey/register/verify" || path === "/auth/passkey/login/verify") {
      const out = await (path.includes("register") ? registerVerify : loginVerify)(env, request, body as never);
      return json({ accountId: out.accountId }, { headers: { "Set-Cookie": out.cookie } });
    }
    // A3 / J3: the passphrase lock, for phones without passkeys.
    if (path === "/auth/passphrase/register" || path === "/auth/passphrase/login") {
      const out = await (path.endsWith("register") ? registerPassphrase : loginPassphrase)(env, body as never);
      return json({ accountId: out.accountId }, { headers: { "Set-Cookie": out.cookie } });
    }
    if (path === "/auth/me") {
      const id = await sessionAccount(env, request);
      return id ? json({ accountId: id }) : unauthorised();
    }
    if (path === "/auth/logout") return new Response(null, { status: 204, headers: { "Set-Cookie": signOutCookie } });
    return new Response("not found", { status: 404 });
  } catch (e) {
    if (e instanceof AuthError) return new Response(e.message, { status: 400 });
    // Never leak internals (D1/SQLite/provider text) to the phone; log content-free.
    console.warn(JSON.stringify({ ra: "auth", failed: true }));
    return new Response("Ra couldn't finish that just now. Try again in a moment.", { status: 500 });
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") return json({ ok: true, env: env.RA_ENV });
    // Live Muse acceptance: synthetic requests only, behind its own token.
    if (path === "/muse/probe") return museProbe(request, env);
    if (path.startsWith("/auth/")) return auth(request, env, path);

    // GET /ray: upgrade to the live socket, routed to your Mind.
    if (path === "/ray" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const who = await person(request, env);
      if (!who) return unauthorised();
      if (!accountMatches(request, who)) return new Response("The signed-in account changed. Unlock its local copy first.", { status: 409 });
      // The Mind learns its own name from the request.
      const forward = new URL(request.url);
      forward.searchParams.set("person", who);
      return env.MIND.getByName(who).fetch(new Request(forward, request));
    }

    // The Ear's webhook is Meta's: checked by its signature, not a session.
    if (path === "/ear/webhook") return earWebhook(request,env,{decodeAudio:(bytes,type)=>decodeEarAudio(bytes,type,earOpus)});
    // G5: a landfall postcard is public by its owner's choice, at a link nobody can guess.
    if (path.startsWith("/l/") && /\.(json|wav)$/.test(path)) return (await postcard(env, path)) ?? new Response("not found", { status: 404 });
    // K1: the funder side, kept on the ledger (its own token, never a session).
    if (path.startsWith("/funders/")) return (await funders(request, env, path)) ?? new Response("not found", { status: 404 });
    // The key phones subscribe to content-free notifications with. Public by design.
    if (path === "/push/key") return json({ key: env.RA_VAPID_PUBLIC ?? null });

    const apis = ["/capture/reviewed", "/markers/reach", "/markers/list", "/landfall/prepare", "/landfall/confirm", "/sync", "/horizon", "/evidence", "/export", "/me", "/voice", "/transcribe", "/capture", "/chart/ask", "/push", "/ear/link", ...(env.RA_ENV === "dev" ? ["/dev/watch", "/dev/seed", "/dev/reading", "/dev/season", "/dev/funder"] : [])];
    const routePaths=["/route/propose","/route/status","/route/cancel","/route/accept","/dial/evidence","/dial/generate","/dial/status","/dial/cancel"];
    const api = apis.includes(path) || routePaths.includes(path) || path.startsWith("/people/") || (path.startsWith("/voyage") && request.method === "POST");
    if (!api) return env.ASSETS.fetch(request); // everything else is the web app

    const who = await person(request, env);
    if (!who) return unauthorised();
    if (!accountMatches(request, who)) return json({code:"account-changed",error:"The signed-in account changed. Sign in to the account whose local copy is open."}, { status: 409 });
    const mind = env.MIND.getByName(who);

    if(routePaths.includes(path))return routeApi(request,mind);

    if(path==="/capture/reviewed"&&request.method==="POST") {
      if(!request.headers.get("content-type")?.startsWith("application/json"))return new Response("Reviewed text is required.",{status:415});
      const length=request.headers.get("content-length");if(length&&Number(length)>32768)return new Response("This reviewed capture is too large.",{status:413});
      const reader=request.body?.getReader();if(!reader)return new Response("Reviewed text is required.",{status:400});
      const parts:Uint8Array[]=[];let used=0;
      try {while(true){const next=await reader.read();if(next.done)break;used+=next.value.length;if(used>32768){await reader.cancel();return new Response("This reviewed capture is too large.",{status:413})}parts.push(next.value)}}finally{reader.releaseLock()}
      const raw=new Uint8Array(used);let at=0;for(const part of parts){raw.set(part,at);at+=part.length;part.fill(0)}
      let body:unknown;try{body=JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(raw))}catch{return new Response("Reviewed text is required.",{status:400})}finally{raw.fill(0)}
      try{return json(await mind.fileReviewedCapture(await checkReviewedCapture(body)),{headers:{"cache-control":"private, no-store"}})}
      catch(error){return json({error:error instanceof Error?error.message:"The reviewed capture could not be filed."},{status:error instanceof ReviewedCaptureError?error.status:409})}
    }

    if (path === "/markers/list") {
      try { return json(await mind.markersFor(url.searchParams.get("island") ?? "")); } catch (e) { return json({ error: e instanceof Error ? e.message : "Markers unavailable" },{ status:409 }); }
    }
    if (["/markers/reach","/landfall/prepare","/landfall/confirm"].includes(path) && request.method === "POST") {
      const body = await request.json().catch(() => null) as Record<string,unknown> | null;
      if (!body) return new Response("a body is needed",{ status:400 });
      try {
        if (path !== "/markers/reach") await reconcilePeople(env,who);
        if (path === "/markers/reach") return json(await mind.reachMarker({ island:String(body.island ?? ""),markerId:String(body.markerId ?? ""),evidence:String(body.evidence ?? "") }));
        if (path === "/landfall/prepare") return json(await mind.prepareLandfall({ island:String(body.island ?? ""),said:String(body.said ?? ""),witnesses:Array.isArray(body.witnesses) ? body.witnesses.filter((s): s is string => typeof s === "string").slice(0,8) : [] }));
        const result = await mind.confirmArrival(String(body.landfallId ?? ""),String(body.rayId ?? ""),String(body.said ?? ""),Array.isArray(body.witnesses) ? body.witnesses.filter((s): s is string => typeof s === "string").slice(0,8) : undefined);
        await deliverArrivals(env,who);
        return json(result);
      } catch (e) { return json({ error:e instanceof Error ? e.message : "The arrival could not be recorded." },{ status:409 }); }
    }
    // POST /sync: {since, outbox} → new events and your latest seq.
    if (path === "/sync" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { since?: unknown; outbox?: unknown } | null;
      const since = typeof body?.since === "number" && body.since >= 0 ? body.since : 0;
      const outbox = Array.isArray(body?.outbox) ? body.outbox : [];
      try {
        await reconcilePeople(env, who);
        await reconcileEar(env,who);
        try { await recoverLedger(env,who); } catch { console.warn(JSON.stringify({ra:"ledger-delivery",deferred:true})); }
        const result = await mind.sync(since, outbox);
        try { await deliverArrivals(env,who); } catch { console.warn(JSON.stringify({ ra:"arrival-delivery",deferred:true })); }
        return json(result);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "sync failed" }, { status: 400 });
      }
    }

    // GET /horizon: your field's signals (E1, E2).
    if (path === "/horizon") {
      const fieldId = await mind.field();
      const field = FIELDS.find((f) => f.id === fieldId) ?? null;
      const signals = field ? await env.HORIZON.getByName(field.id).signals(field.id) : [];
      const refresh=field?await env.HORIZON.getByName(field.id).refreshStatus():null;
      return json({ field: field && { id: field.id, name: field.name }, signals,refresh });
    }

    // POST /evidence: C3 bring back. A voice clip (and a photo), transcribed and kept, sealed.
    if (path === "/evidence" && request.method === "POST") {
      const form = await request.formData();
      const tripId = String(form.get("tripId") ?? "");
      const clip = form.get("clip");
      const photo = form.get("photo");
      if (!tripId || !(clip instanceof File)) return new Response("a trip and a clip are needed", { status: 400 });
      const clipBytes = new Uint8Array(await clip.arrayBuffer());
      const text = await transcribeClip(env, base64(clipBytes)).catch(() => "");
      const out = await mind.bringBack({
        tripId,
        text,
        clip: clipBytes,
        ...(photo instanceof File ? { photo: { bytes: new Uint8Array(await photo.arrayBuffer()), type: photo.type } } : {}),
      });
      return json(out);
    }

    // Dev only: run the Watch now instead of at 2 AM.
    if (path === "/dev/watch" && request.method === "POST") {
      await mind.watchNow();
      return json({ started: true });
    }

    // Dev only: a mission funder, from the K1 board's words.
    if (path === "/dev/funder" && request.method === "POST") {
      return json(await devFunder(env, ((await request.json().catch(() => ({}))) as { name?: string; mission?: string; budgetCents?: number })));
    }

    // Dev only: prepare a Reading or a season review now instead of on its night.
    if ((path === "/dev/reading" || path === "/dev/season") && request.method === "POST") {
      await mind.rhythmNow(path === "/dev/reading" ? "reading" : "season");
      return json({ started: true });
    }

    // Dev only: give an empty Mind Amani's story from the canvas, for the demo.
    if (path === "/dev/seed" && request.method === "POST") {
      try {
        const seeded = await mind.seed(amani(Date.now(), Number(url.searchParams.get("tz") ?? 180)));
        await env.DB.prepare("DELETE FROM people_erased WHERE account = ?").bind(who).run();
        return json(seeded);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "seed failed" }, { status: 409 });
      }
    }

    // Content-free notifications: where to knock (POST), or stop (DELETE).
    if (path === "/push" && (request.method === "POST" || request.method === "DELETE")) {
      const body = (await request.json().catch(() => null)) as { endpoint?: unknown; keys?: { p256dh?: string; auth?: string } } | null;
      if (typeof body?.endpoint !== "string") return new Response("an endpoint is needed", { status: 400 });
      if (request.method === "DELETE") await mind.removePush(body.endpoint);
      else await mind.addPush({ endpoint: body.endpoint, ...(body.keys ? { keys: body.keys } : {}) });
      return new Response(null, { status: 204 });
    }

    // Layer 4: voyages, claims, paying it forward.
    const sailed = await voyage(request, env, path, who);
    if (sailed) return sailed;

    // Layer 3: beacon, introductions, witnesses, postcards, safety.
    const answered = await people(request, env, path, who);
    if (answered) return answered;

    // A5: link the Ear with a one-time code, or unlink it.
    if (path === "/ear/link" && (request.method === "POST" || request.method === "DELETE")) return earLink(request, env, who);

    // C2 · Speak. POST /transcribe: a held thought's words, and the command it is if it's one. Nothing is kept.
    if (path === "/transcribe" && request.method === "POST") {
      const clip = (await request.formData()).get("clip");
      if (!(clip instanceof File)) return new Response("a clip is needed", { status: 400 });
      const text = await transcribeClip(env, base64(new Uint8Array(await clip.arrayBuffer()))).catch(() => "");
      return json({ text, command: spokenCommand(text) });
    }

    // POST /capture: keep the thought (after the phone's undo window), with your voice.
    // A thought held offline arrives without words; it's read here.
    // E1 · Ask the Chart: one question, answered only from the person's own Chart, with exact quotes.
    if (path === "/chart/ask" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
      if (typeof body?.question !== "string" || !body.question.trim() || body.question.length > 600) return new Response("a question is needed", { status: 400 });
      try {
        return json(await mind.chartAnswer(body.question), { headers: { "cache-control": "no-store" } });
      } catch (error) {
        const message = error instanceof Error && /Chart|Muse/.test(error.message) ? error.message : "Your Chart couldn't be read just now. Try again.";
        return json({ error: message }, { status: 502, headers: { "cache-control": "no-store" } });
      }
    }

    if (path === "/capture" && request.method === "POST") {
      const form = await request.formData();
      const clip = form.get("clip");
      const bytes = clip instanceof File ? new Uint8Array(await clip.arrayBuffer()) : null;
      let text = String(form.get("text") ?? "").trim();
      if (!text && bytes) text = await transcribeClip(env, base64(bytes)).catch(() => "");
      if (!text) return json({ kept: false });
      const pcm = bytes ? pcmOf(bytes) : null;
      return json({ kept: true, ...(await mind.capture({ text, ...(pcm ? { pcm } : {}) })) });
    }

    // GET /voice?id=: one of your utterances as you said it (G2), opened from its sealed copy.
    if (path === "/voice") {
      const id = url.searchParams.get("id") ?? "";
      const bytes = id ? await mind.voice(id) : null;
      return bytes ? new Response(bytes, { headers: { "content-type": "audio/wav", "cache-control": "private, no-store" } }) : new Response("not kept", { status: 404 });
    }

    // GET /export: take everything with you (I1).
    if (path === "/export") {
      const data = await mind.exportAll();
      const parts = mindExport(data,{voice:id=>mind.voice(id),evidence:id=>mind.exportEvidence(id)});
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        async pull(controller) { try { const next = await parts.next(); if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value)); } catch (e) { controller.error(e); } },
        async cancel() { await parts.return(undefined); },
      }), { headers: { "content-type": "application/json", "cache-control": "private, no-store", "Content-Disposition": "attachment; filename=ra-mind.json" } });
    }

    // DELETE /me: forget everything. The Mind, its R2 folder, its D1 rows and its key.
    if (path === "/me" && request.method === "DELETE") {
      await forgetLedger(env,who);
      await forgetPerson(env, who);
      await mind.erase();
      let cursor: string | undefined;
      do {
        const list = await env.FILES.list({ prefix: `${who}/`, ...(cursor ? { cursor } : {}) });
        if (list.objects.length) await env.FILES.delete(list.objects.map((o) => o.key));
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
      await eraseAccount(env, who);
      return new Response(null, { status: 204, headers: { "Set-Cookie": signOutCookie } });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
import {mindExport} from "./mind/export";
