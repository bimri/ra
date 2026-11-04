import { useEffect, useState } from "preact/hooks";
import { api } from "../../store/device";
import { mind, useMind } from "../../store/mind";
import { GlBox } from "../../sky/GlBox";
import { BackHeader } from "../../ui/BackHeader";
import { Icon } from "../../ui/icons";

// H1 · Your beacon. Your mind never leaves; only your beacon shines: a few
// words you write yourself, your star and (if you choose) your island.
// Introductions need two yeses. Turn it off any time.

type Shines = "star" | "star+island" | "off";

export function BeaconScreen() {
  const { views } = useMind();
  const star = views.star.current;
  const island = Object.keys(views.markers).at(-1) ?? null;
  const lit = views.beacon?.lit ?? false;
  const [shines, setShines] = useState<Shines>(lit ? (views.beacon!.shines) : "star+island");
  const suggested = (s: Shines) => (star ? `${star}${s === "star+island" && island ? ` On the island of ${island.toLowerCase()}.` : ""}` : "");
  const [text, setText] = useState(views.beacon?.text ?? suggested("star+island"));
  const [name, setName] = useState(views.beacon?.name ?? "");
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");

  // The phone's copy of your mind loads after the first paint: fill in what you wrote once it's here.
  const saved = views.beacon;
  useEffect(() => {
    if (!saved) {
      if (star && !text) setText(suggested(shines));
      return;
    }
    setText((t) => t || saved.text);
    setName((n) => n || saved.name);
    if (saved.lit) setShines(saved.shines);
  }, [saved?.text, saved?.name, saved?.shines, saved?.lit, star]);

  function pick(s: Shines) {
    // Your words stay yours; only the suggestion follows what shines.
    if (text === suggested(shines)) setText(suggested(s));
    setShines(s);
  }

  async function save() {
    setState("sending");
    const res =
      shines === "off"
        ? await fetch(api("/people/beacon"), { method: "DELETE", credentials: "include" }).catch(() => null)
        : await fetch(api("/people/beacon"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: name.trim(), text: text.trim(), shines }),
            credentials: "include",
          }).catch(() => null);
    if (!res?.ok) return setState("failed");
    await mind().sync();
    setState("idle");
  }

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <BackHeader to="/crews" title="Your beacon" purpose="Let people steering by a star like yours find you. Nothing happens without two yeses." />
        <div class="card" style={{ marginTop: "10px", padding: 0, height: "200px", position: "relative", overflow: "hidden", flex: "none", background: "var(--bg)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
          <GlBox scene="sea" options={{ hz: 0.62, sx: 0.62, sr: 0.012, sink: 0, voice: "calm", fov: 30, beam: lit }} style={{ position: "absolute", inset: 0 }}>
            <div class="horizon" style={{ top: "124px" }} />
          </GlBox>
          <span class="label" style={{ position: "absolute", left: "14px", top: "14px", color: "var(--text)" }}>
            Beacon · {shines === "star" ? "star only" : "star + island"}
          </span>
          <span class="label" style={{ position: "absolute", right: "14px", top: "14px" }}>
            {lit && <span class="blink" style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--sig)", marginRight: "6px", boxShadow: "0 0 8px var(--sig)" }} />}
            {lit ? "shining" : "dark"}
          </span>
        </div>
        <div class="h1" style={{ fontSize: "32px", marginTop: "18px" }}>
          Your mind never leaves. <span class="accent">Only your beacon shines.</span>
        </div>
        {!star ? (
          <p class="meta" style={{ margin: "14px 0 0" }}>
            Write your Star in a Ray first.
          </p>
        ) : (
          <>
            <div class="card" style={{ marginTop: "16px" }}>
              <label class="label" for="beacon-words">
                Your beacon, in your words
              </label>
              <textarea
                id="beacon-words"
                value={text}
                onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
                rows={3}
                maxLength={280}
                style={{ display: "block", width: "100%", margin: "8px 0 0", font: "inherit", fontSize: "18px", lineHeight: 1.3, letterSpacing: "-.02em", color: "var(--text)", background: "transparent", border: "none", resize: "none", outline: "none", padding: 0 }}
              />
            </div>
            <label class="label" for="beacon-name" style={{ marginTop: "16px" }}>
              The name crewmates see
            </label>
            <input id="beacon-name" class="field" value={name} maxLength={40} placeholder="Your first name" onInput={(e) => setName((e.target as HTMLInputElement).value)} style={{ marginTop: "8px", border: "none", font: "400 17px 'Inter Tight',sans-serif", color: "var(--text)", background: "transparent" }} />
          </>
        )}
        <div class="label" style={{ marginTop: "18px" }}>
          What shines
        </div>
        <div class="seg" style={{ marginTop: "10px" }} role="radiogroup" aria-label="What shines">
          {(
            [
              ["star", "Star only"],
              ["star+island", "Star + island"],
              ["off", "Off"],
            ] as const
          ).map(([k, label]) => (
            <span key={k} role="radio" aria-checked={shines === k} tabIndex={0} class={shines === k ? "on" : ""} onClick={() => pick(k)}>
              {label}
            </span>
          ))}
        </div>
        <p class="meta" style={{ margin: "12px 0 0" }}>
          Introductions need two yeses. Turn it off any time.
        </p>
        {state === "failed" && (
          <p class="meta" role="alert" style={{ color: "var(--accent)", margin: "8px 0 0" }}>
            That didn't go through. Try again.
          </p>
        )}
        <div style={{ flex: 1, minHeight: "18px" }} />
        <div style={{ paddingBottom: "30px" }}>
          <button
            type="button"
            class="btn btn-accent"
            style={{ width: "100%" }}
            disabled={state === "sending" || (shines !== "off" && (!star || !name.trim() || !text.trim())) || (shines === "off" && !lit)}
            onClick={() => void save()}
          >
            <Icon name="beacon" size={18} /> {shines === "off" ? "Turn my beacon off" : lit ? "Update my beacon" : "Light my beacon"}
          </button>
        </div>
      </div>
    </div>
  );
}
