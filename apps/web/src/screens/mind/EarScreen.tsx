import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../store/device";
import { mind, useMind } from "../../store/mind";
import { go } from "../../ui/nav";
import { Tip, GLOSSARY } from "../../ui/Tooltip";
import {localSession,checkLocalSession} from "../../store/db";

// A5 · Link the Ear: send Ra quick thoughts from WhatsApp. You link it by
// sending Ra a one-time code from your own WhatsApp, so Ra never asks for
// or keeps your number: only a keyed hash of your WhatsApp ID, in D1.

interface Link {
  code: string;
  /** Ra's WhatsApp number, when one is set up. */
  number: string | null;
  expiresAt: number;
}

export function EarScreen() {
  const { views } = useMind();
  const [discreet, setDiscreet] = useState(true);
  const [link, setLink] = useState<Link | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy,setBusy]=useState(false),[unlinkPending,setUnlinkPending]=useState(false),[now,setNow]=useState(Date.now());
  const action=useRef<AbortController|null>(null),mounted=useRef(true);
  const linked = views.ear.linked;
  const expired=!!link&&now>=link.expiresAt;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;action.current?.abort()}},[]);
  useEffect(()=>{if(!linked&&unlinkPending){setUnlinkPending(false);setProblem(null)}},[linked,unlinkPending]);

  // While the code is out, look for the link landing in your mind.
  useEffect(() => {
    if ((!link || linked || expired)&&!unlinkPending) return;
    const scope=localSession(),copy=mind();let active=true;
    const t = setInterval(() => {try{checkLocalSession(scope);if(active)void copy.sync().catch(()=>{})}catch{clearInterval(t)}}, 3000);
    return () => {active=false;clearInterval(t)};
  }, [link, linked, expired,unlinkPending]);
  useEffect(()=>{if(!link||linked)return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[link,linked]);

  async function connect() {
    if(action.current)return;const controller=new AbortController();action.current=controller;setBusy(true);setProblem(null);
    try{const scope=localSession();const res = await fetch(api("/ear/link"), {
      method: "POST",
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]),
      headers: { "content-type": "application/json","x-ra-account":scope.owner },
      body: JSON.stringify({ discreet }),
      credentials: "include",
    });checkLocalSession(scope);controller.signal.throwIfAborted();
    if(!res.ok)throw new Error("Ra couldn't make a code just now. Try again.");
    const value=await res.json() as Link;checkLocalSession(scope);controller.signal.throwIfAborted();
    if(!/^[A-HJ-NP-Z2-9]{6}$/.test(value.code)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Date.now()+605_000||(value.number!==null&&typeof value.number!=="string"))throw new Error("This code could not be opened. Try again.");
    setNow(Date.now());setLink(value);
    }catch{if(mounted.current&&!controller.signal.aborted)setProblem("Ra couldn't make a code just now. Try again.")}
    finally{if(action.current===controller)action.current=null;if(mounted.current&&!controller.signal.aborted)setBusy(false)}
  }

  async function unlink() {
    if(action.current)return;const controller=new AbortController();action.current=controller;setBusy(true);setProblem(null);
    try{const scope=localSession(),copy=mind(),response=await fetch(api("/ear/link"),{method:"DELETE",credentials:"include",headers:{"x-ra-account":scope.owner},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])});checkLocalSession(scope);controller.signal.throwIfAborted();if(!response.ok)throw new Error("unlink failed");setLink(null);setUnlinkPending(true);setProblem("Unlink saved. Waiting for your Mind to catch up.");await copy.sync();checkLocalSession(scope);controller.signal.throwIfAborted()}
    catch{if(mounted.current&&!controller.signal.aborted)setProblem("The unlink could not be confirmed. Try again when connected.")}
    finally{if(action.current===controller)action.current=null;if(mounted.current&&!controller.signal.aborted)setBusy(false)}
  }

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
        <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
          <span class="label">The Ear · optional</span>
          <a href="/mind" onClick={go("/mind")} class="btn btn-line btn-sm">
            {linked ? "Done" : "Skip"}
          </a>
        </header>
        <div class="h1" style={{ marginTop: "24px" }}>
          {unlinkPending ? "Unlinking the Ear." : linked ? "The Ear is listening." : "Quick thoughts from WhatsApp."}
        </div>

        {!linked && link && (
          <div class="card" style={{ marginTop: "22px" }}>
            <div class="label">{expired?"This code has expired":"Send this to Ra on WhatsApp"}</div>
            <div class="dot glow" style={{ fontSize: "44px", marginTop: "10px", letterSpacing: ".08em" }}>
              {link.code}
            </div>
            <p class="meta" style={{ margin: "8px 0 0" }}>
              Ra never keeps your number. {expired?"Make a new code to connect.":`The code works for ${Math.max(1,Math.ceil((link.expiresAt-now)/60_000))} minutes.`}
            </p>
            {link.number && !expired ? (
              <a href={`https://wa.me/${link.number.replace(/\D/g, "")}?text=${encodeURIComponent(link.code)}`} class="btn btn-ink btn-sm" style={{ marginTop: "12px" }}>
                Open WhatsApp
              </a>
            ) : (
              <p class="meta" style={{ margin: "10px 0 0", color: "var(--accent)" }}>
                {expired?"An expired code cannot link your Mind.":"Ra's WhatsApp number isn't set up yet."}
              </p>
            )}
          </div>
        )}

        <div class="row" style={{ marginTop: "18px", alignItems: "flex-start", padding: "14px 0" }}>
          <div class="grow">
            <div class="title" style={{ fontSize: "15px" }}>
              Discreet mode
            </div>
            <div class="meta" style={{ marginTop: "2px" }}>
              Replies there never mention anything private. Anyone holding your phone can read that chat.
            </div>
          </div>
          <button
            type="button"
            class={`switch${(linked ? views.ear.discreet : discreet) ? " on" : ""}`}
            role="switch"
            aria-checked={linked ? views.ear.discreet : discreet}
            aria-label="Discreet mode"
            disabled={linked||busy}
            onClick={() => setDiscreet((d) => !d)}
            style={{ border: "none", cursor: linked ? "default" : "pointer" }}
          />
        </div>
        {problem && (
          <p class="meta" role="alert" style={{ color: "var(--accent)", margin: "8px 0 0" }}>
            {problem}
          </p>
        )}
        <div style={{ flex: 1 }} />
        <div class="stack" style={{ gap: "8px", paddingBottom: "30px" }}>
          {linked ? (
            <button type="button" class="btn btn-line" disabled={busy||unlinkPending} onClick={() => void unlink()}>
              {busy?"Unlinking…":unlinkPending?"Waiting for sync…":"Unlink the Ear"}
            </button>
          ) : (
            <>
              <button type="button" class="btn btn-ink" disabled={busy} onClick={() => void connect()}>
                {busy?"Making a code…":link ? "Make a new code" : "Connect"}
              </button>
              <a href="/mind" onClick={go("/mind")} class="btn btn-line">
                Not now
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
