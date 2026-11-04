import { closeVault, forgetVault, eraseNativeCaptures, vaultAccount } from "../../auth/vault";
import { isPhoneEditKind } from "@ra/core";
import { useEffect, useState } from "preact/hooks";
import { store } from "../../store/db";
import { api } from "../../store/device";
import { pushOn, pushSupported, turnOffPush, turnOnPush } from "../../store/push";
import { useMind } from "../../store/mind";
import { rename } from "../../store/person";
import { BackHeader } from "../../ui/BackHeader";
import { Icon } from "../../ui/icons";
import { go, navigate } from "../../ui/nav";
import { Tip } from "../../ui/Tooltip";

/** End the online session and lock the local copy; the next person sees the lock screen. */
async function signOut(): Promise<void> {
  await fetch(api("/auth/logout"), { method: "POST", credentials: "include", cache: "no-store" }).catch(() => null);
  closeVault();
  navigate("/");
}
import { LANGS, prefs, type DataMode } from "../onboarding/FirstLight";

// I1 · Your mind. "What Ra holds is yours": what's in it, how to see it, take
// it with you, or have all of it forgotten.

const DATA: Record<DataMode, string> = {
  automatic: "live on Wi-Fi · walkie on data",
  live: "always live",
  walkie: "walkie",
};

export function YourMindScreen() {
  const { views,pending } = useMind();
  const earlier = pending.filter((d) => !isPhoneEditKind(d.kind));
  const [forgetting, setForgetting] = useState<"ask" | "sure" | "going" | "failed">("ask");
  const lang = LANGS.find((l) => l.code === prefs.get("lang", "en"))?.label ?? "English";
  const counts: [number, string][] = [
    [Object.keys(views.rays).length, "Rays"],
    [views.captures, "captures"],
    [Object.keys(views.memories).length, "memories"],
    [views.rings.length, "rings"],
  ];
  const nights = Object.keys(views.nightLogs).length > 0;
  // A2b: what Ra calls you, changed here.
  const [naming, setNaming] = useState<string | null>(null);
  // Content-free notifications: only that something is waiting, for four reasons.
  const [push, setPush] = useState<"on" | "off" | "blocked" | "unavailable">(pushSupported() ? "off" : "unavailable");
  useEffect(() => {
    void pushOn().then((on) => on && setPush("on"));
  }, []);
  async function togglePush() {
    if (push === "on") {
      await turnOffPush();
      setPush("off");
    } else setPush(await turnOnPush().then((r) => (r === "on" ? "on" : r)));
  }

  async function forgetEverything() {
    if (forgetting === "ask") return setForgetting("sure");
    setForgetting("going");
    try {
      const account=vaultAccount();if(!account)throw new Error("Unlock first.");
      const receipt=`ra.erase.${account}`;
      if(!localStorage.getItem(receipt)) {
        const res = await fetch(api("/me"), { method: "DELETE", credentials: "include" });
        if (!res.ok) throw new Error(`forget ${res.status}`);
        localStorage.setItem(receipt,"server-erased-v1");
      }
      await eraseNativeCaptures();
      await store.wipe();
      await forgetVault();
      try {
        // Other accounts retain their own encrypted copies and wrapped keys.
        if(localStorage.getItem("ra.account")===account)localStorage.removeItem("ra.account");
        localStorage.removeItem("ra.firstLight");
      } catch {
        // storage off: nothing kept here anyway
      }
      // A fresh start: nothing of the old mind stays in memory either.
      location.replace("/");
    } catch {
      setForgetting("failed");
    }
  }

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <BackHeader to="/" title="Your mind" purpose="What Ra keeps, and how to see it, take it, or have it forgotten." />
        <div class="hair" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", marginTop: "18px" }}>
          {counts.map(([n, label], i) => (
            <div key={label} style={{ padding: i ? "12px 0 0 10px" : "12px 0 0 0", borderLeft: i ? "1px solid var(--line)" : undefined }}>
              <div class="big" style={{ fontSize: "30px" }}>
                {n}
              </div>
              <div class="meta">{label}</div>
            </div>
          ))}
        </div>

        {earlier.length > 0 && <div class="card" style={{ marginTop:"18px" }}>
          <div class="title">Earlier drafts · {earlier.length}</div>
          <p class="meta">Saved on this phone. Review before recording.</p>
          {earlier.map((d) => {
            const body = d.body as { said?:string; text?:string; markers?:{ text:string; evidence:string }[] };
            return <details key={d.id}><summary class="meta">Draft · {new Date(d.at).toLocaleDateString()}</summary>
              <p class="serif">{body.said ?? body.text ?? "Saved for review."}</p>
              {body.markers?.map((m) => <p class="meta" key={m.text}>{m.text}: {m.evidence}</p>)}
            </details>;
          })}
          <a href="/landfall" onClick={go("/landfall")} class="btn btn-line btn-sm">Review landfall</a>
        </div>}
        <div style={{ marginTop: "18px" }}>
          {naming === null ? (
            <button type="button" class="row" style={{ width: "100%", background: "none", border: "none", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }} onClick={() => setNaming(views.person?.name ?? "")}>
              <span class="grow title" style={{ fontSize: "15px" }}>What Ra calls you</span>
              <span class="meta">{views.person?.name ?? "No name yet"}</span>
            </button>
          ) : (
            <form class="row" style={{ gap: "8px" }} onSubmit={(e) => { e.preventDefault(); void rename(naming).then(() => setNaming(null)); }}>
              <input class="field grow" aria-label="Your name" autocomplete="given-name" maxLength={40} value={naming} onInput={(e) => setNaming((e.target as HTMLInputElement).value)} style={{ border: "none", background: "transparent", font: "400 16px 'Inter Tight',sans-serif", color: "var(--text)" }} />
              <button type="submit" class="btn btn-ink btn-sm">Save</button>
            </form>
          )}
          <a href="/memories" onClick={go("/memories")} class="row">
            <span class="grow title" style={{ fontSize: "15px" }}>
              See everything Ra remembers
            </span>
            <Icon name="arrow" size={18} />
          </a>
          <a href="/watch" onClick={go("/watch")} class="row">
            <span class="grow title" style={{ fontSize: "15px" }}>
              What Ra did last night
            </span>
            {nights ? <Icon name="arrow" size={18} /> : <span class="meta">nothing yet</span>}
          </a>
          <a href="/ear" onClick={go("/ear")} class="row">
            <span class="grow title" style={{ fontSize: "15px" }}>
              The Ear
            </span>
            <span class="meta">{views.ear.linked ? `WhatsApp${views.ear.discreet ? " · discreet" : ""}` : "Connect"}</span>
          </a>
          <a href="/mind/sign-in" onClick={go("/mind/sign-in")} class="row">
            <span class="grow title" style={{fontSize:"15px"}}>Your online Mind</span>
            <span class="meta">Sign in again</span>
          </a>
          <button type="button" class="row" style={{ width: "100%", background: "none", border: "none", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }} onClick={() => void signOut()}>
            <span class="grow title" style={{fontSize:"15px"}}>Sign out</span>
            <span class="meta">Locks this phone's copy</span>
          </button>
          <a href="/mind/export" onClick={go("/mind/export")} class="row">
            <span class="grow title" style={{ fontSize: "15px" }}>
              Take it all with you
            </span>
            <span class="meta">Export</span>
          </a>
        </div>

        <LocalPasskeySettings/>
        <div style={{ marginTop: "14px" }}>
          {(
            [
              ["Lock", "after 5 min · local unlock"],
              ["Devices", "this phone"],
              ["On mobile data", DATA[prefs.get<DataMode>("dataMode", "automatic")]],
              ["Language", `${lang} · follows you`],
              ["Who funds your voyage", "no one yet"],
            ] as const
          ).map(([label, value]) => (
            <div key={label} class="row" style={{ minHeight: "44px" }}>
              <span class="label" style={{ flex: 1 }}>
                {label}
              </span>
              <span style={{ fontSize: "13.5px" }}>{value}</span>
            </div>
          ))}
        </div>

        <div class="row" style={{ minHeight: "44px" }}>
          <span class="label" style={{ flex: 1 }}>
            Notifications
          </span>
          {push === "unavailable" ? (
            <span style={{ fontSize: "13.5px" }}>not on this phone</span>
          ) : push === "blocked" ? (
            <span style={{ fontSize: "13.5px" }}>blocked in settings</span>
          ) : (
            <Tip text="Never shows what's inside"><button type="button" class={`switch${push === "on" ? " on" : ""}`} role="switch" aria-checked={push === "on"} aria-label="Notifications that never show what's inside" onClick={() => void togglePush()} style={{ border: "none", cursor: "pointer" }} /></Tip>
          )}
        </div>
        <button type="button" class="btn btn-line" style={{ marginTop: "16px", color: "#E5322D", flex: "none" }} onClick={forgetEverything} disabled={forgetting === "going"}>
          {forgetting === "ask" ? "Forget everything" : forgetting === "sure" ? "Tap again: this can't be undone" : forgetting === "going" ? "Forgetting…" : "That didn't go through. Try again"}
        </button>
        <div style={{ flex: 1 }} />
        <p class="meta" style={{ paddingBottom: "28px" }}>
          Ra never trains on your mind and never sells it.
        </p>
      </div>
    </div>
  );
}
import {LocalPasskeySettings} from "./LocalPasskeySettings";
