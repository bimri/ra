import { useState } from "preact/hooks";
import { passkeysAvailable, signIn, signInWithPassphrase } from "../../auth/passkey";
import { rememberedAccount, unlock } from "../../auth/lock";
import { useMind } from "../../store/mind";
import { GlBox } from "../../sky/GlBox";
import { LockRings } from "../../ui/art/LockRings";

// J3 · Locked. Nothing of your mind shows until you unlock with your passkey.
// "Ra has something for you" only says that something is waiting, never what.

export function LockedScreen() {
  const { views } = useMind();
  const [problem, setProblem] = useState<string | null>(null);
  const [usePhrase, setUsePhrase] = useState(!passkeysAvailable());
  const [phrase, setPhrase] = useState("");
  const waiting = views.today.length > 0 || Object.keys(views.nightLogs).length > 0;

  async function open() {
    setProblem(null);
    try {
      if (usePhrase) {
        const id = rememberedAccount();
        if (!id) throw new Error("This phone doesn't hold a Ra account.");
        await signInWithPassphrase(id, phrase);
      } else await signIn();
      unlock();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't open. Try again.");
    }
  }

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ flex: 1 }} />
        <GlBox
            scene="lock"
            label="A lock drawn as nine broken metal rings around a glowing core. They turn on their own axes, then swing into line."
            style={{ width: "240px", height: "240px", margin: "0 auto", flex: "none" }}
          >
            <div style={{ position: "absolute", inset: "10px" }}>
              <LockRings size={220} />
            </div>
          </GlBox>
        <div class="h1" style={{ textAlign: "center", marginTop: "24px" }}>
          Ra is locked.
        </div>
        {waiting && (
          <p class="meta" style={{ textAlign: "center", margin: "10px 0 0" }}>
            Ra has something for you.
          </p>
        )}
        {problem && (
          <p class="meta" role="alert" style={{ textAlign: "center", color: "var(--accent)", margin: "10px 0 0" }}>
            {problem}
          </p>
        )}
        <div style={{ flex: 1 }} />
        <div class="stack" style={{ gap: "8px", paddingBottom: "18px" }}>
          {usePhrase && (
            <input class="field" type="password" autocomplete="current-password" aria-label="Your passphrase" placeholder="Your passphrase" value={phrase} onInput={(e) => setPhrase((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && void open()} style={{ border: "none", font: "400 16px 'Inter Tight',sans-serif", color: "var(--text)", background: "transparent" }} />
          )}
          <button type="button" class="btn btn-ink" onClick={open} disabled={usePhrase && !phrase}>
            Unlock
          </button>
          {passkeysAvailable() && (
            <button type="button" class="btn btn-line" onClick={() => setUsePhrase((u) => !u)}>
              {usePhrase ? "Use fingerprint or screen lock" : "Use passphrase"}
            </button>
          )}
        </div>
        <p class="label" style={{ textAlign: "center", paddingBottom: "30px" }}>
          Locked after 5 minutes away
        </p>
      </div>
    </div>
  );
}
