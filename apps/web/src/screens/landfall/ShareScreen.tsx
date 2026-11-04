import type { ShareItem } from "@ra/core";
import { useState } from "preact/hooks";
import { api } from "../../store/device";
import { mind, useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";

// G5 · Share a landfall. A postcard at a link nobody can guess, carrying
// only what you switch on. Your mind never leaves. Turn the link off any
// time, and the postcard is gone.

const long = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const dots = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).split("/").join(" · ");

/** The postcard itself, as G5 draws it: the sun over "Landfall.", then the island. Shared with the public page. */
export function PostcardCard({ island, from, at, note, detail }: { island: string; from: string | null; at: number; note: string; detail?: string }) {
  return (
    <div class="card" style={{ marginTop: "16px", padding: 0, overflow: "hidden", position: "relative", flex: "none" }}>
      <div style={{ height: "150px", background: "var(--ink)", position: "relative", overflow: "hidden" }}>
        <div class="orbfx" style={{ width: "240px", height: "240px", right: "-56px", top: "-70px" }} />
        <div class="big" style={{ position: "absolute", left: "18px", bottom: "14px", fontSize: "44px", color: "var(--on-ink)" }}>
          Landfall.
        </div>
        <span class="label" style={{ position: "absolute", left: "18px", top: "16px", color: "var(--on-ink)", opacity: 0.7 }}>
          {dots(at)}
        </span>
      </div>
      <div style={{ padding: "16px 18px" }}>
        <div class="spread" style={{ alignItems: "flex-start" }}>
          <div class="title" style={{ fontSize: "18px" }}>
            {island}
          </div>
          {note && (
            <span class="serif" style={{ fontSize: "18px", fontStyle: "italic", color: "var(--sig)", whiteSpace: "nowrap" }}>
              {note}
            </span>
          )}
        </div>
        <div class="meta">{[from ? `From ${from}` : null, detail ?? long(at)].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
  );
}

export function ShareScreen() {
  const { views } = useMind();
  const id = new URLSearchParams(location.search).get("landfall");
  const landfall = views.landfalls.find((l) => l.landfallId === id) ?? views.landfalls.at(-1);
  const live = views.shares.filter((s) => s.landfallId === landfall?.landfallId);
  const name = views.beacon?.name ?? null;
  const [on, setOn] = useState<Record<ShareItem, boolean>>({ markers: true, voice: true, star: false, rings: false });
  const [note, setNote] = useState(name ? `Made it! — ${name.charAt(0)}.` : "Made it!");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  if (!landfall) {
    return (
      <div class="ui">
        <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
          <BackHeader to="/rings" title="Share a landfall" purpose="Send a postcard of this landfall. You choose what’s on it." />
          <p class="meta" style={{ margin: "18px 0 0" }}>
            A postcard comes with a landfall.
          </p>
        </div>
      </div>
    );
  }

  async function send() {
    setBusy(true);
    const items = (Object.keys(on) as ShareItem[]).filter((k) => on[k]);
    const res = await fetch(api("/people/share"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ landfallId: landfall!.landfallId, items, note }), credentials: "include" }).catch(() => null);
    if (res?.ok) {
      const { url } = (await res.json()) as { url: string };
      const full = `${location.origin}${url}`;
      // The phone's own share sheet when there is one; else the link is copied.
      if (navigator.share) await navigator.share({ title: `Landfall · ${landfall!.island}`, url: full }).catch(() => {});
      else await navigator.clipboard?.writeText(full).then(() => setCopied(full), () => {});
      await mind().sync();
    }
    setBusy(false);
  }

  async function takeDown(token: string) {
    await fetch(api("/people/share"), { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), credentials: "include" }).catch(() => null);
    await mind().sync();
  }

  const rows: [ShareItem, string, string][] = [
    ["markers", "Markers and evidence", landfall.markers.map((m) => m.evidence).filter(Boolean).join(", ") || `${landfall.markers.length} markers`],
    ["voice", "My voice from then", "your longest kept line that month"],
    ["star", "My star", views.star.current ? `${views.star.current.slice(0, 24)}…` : "not written yet"],
    ["rings", "My other rings", `${views.rings.length} in all`],
  ];

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <BackHeader to="/landfall" title="Share a landfall" purpose="Send a postcard of this landfall. You choose what’s on it." />
        <PostcardCard island={landfall.island} from={name} at={landfall.at} note={note} detail={`${landfall.markers.length} ${landfall.markers.length === 1 ? "marker" : "markers"} · ${landfall.witnessedBy.length} ${landfall.witnessedBy.length === 1 ? "witness" : "witnesses"}`} />
        <input class="field" aria-label="Your note on the postcard" value={note} maxLength={60} onInput={(e) => setNote((e.target as HTMLInputElement).value)} style={{ marginTop: "14px", border: "none", minHeight: "44px", font: "italic 18px 'Instrument Serif',serif", color: "var(--text)", background: "transparent" }} />
        <div class="label" style={{ marginTop: "18px" }}>
          What travels with it
        </div>
        <div>
          {rows.map(([k, title, meta]) => (
            <div key={k} class="row">
              <div class="grow">
                <div class="title" style={{ fontSize: "15px" }}>
                  {title}
                </div>
                <div class="meta">{meta}</div>
              </div>
              <button type="button" class={`switch${on[k] ? " on" : ""}`} role="switch" aria-checked={on[k]} aria-label={title} onClick={() => setOn((o) => ({ ...o, [k]: !o[k] }))} style={{ border: "none", cursor: "pointer" }} />
            </div>
          ))}
        </div>
        <p class="meta" style={{ margin: "10px 0 0" }}>
          Only what’s on goes out. Link can be turned off any time.
        </p>
        {live.map((s) => (
          <div key={s.token} class="row">
            <span class="grow meta">Postcard live · {new Date(s.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            <button type="button" class="btn btn-line btn-sm" onClick={() => void takeDown(s.token)}>
              Turn the link off
            </button>
          </div>
        ))}
        {copied && (
          <p class="meta" role="status" style={{ margin: "8px 0 0" }}>
            Link copied.
          </p>
        )}
        <div style={{ flex: 1, minHeight: "18px" }} />
        <div style={{ paddingBottom: "30px" }}>
          <button type="button" class="btn btn-ink" style={{ width: "100%" }} disabled={busy} onClick={() => void send()}>
            Send the postcard
          </button>
        </div>
      </div>
    </div>
  );
}
