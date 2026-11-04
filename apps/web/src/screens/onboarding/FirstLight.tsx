import { useState } from "preact/hooks";
import { passkeysAvailable, register, registerWithPassphrase } from "../../auth/passkey";
import { rememberAccount, unlock } from "../../auth/lock";
import { openVault } from "../../auth/vault";
import { migrateLocal } from "../../store/db";
import { GlBox } from "../../sky/GlBox";
import { LockRings } from "../../ui/art/LockRings";
import { Icon } from "../../ui/icons";
import { navigate } from "../../ui/nav";
import { giveName } from "../../store/person";
import { playListeningTone } from "../../voice/tone";

// First light (A1–A4): language, your name (A2b), the promises, the lock, the one sound.
// The promises are the same six Ra is held to in every line it says.

export const LANGS: { code: string; label: string; soon?: boolean; rtl?: boolean }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "ar", label: "العربية", rtl: true },
  { code: "sw", label: "Kiswahili", soon: true },
];

const PROMISES: [string, string?][] = [
  ["I’ll listen far more than I speak."],
  ["I won’t teach you or test you.", "I’ll help you find your way."],
  ["I won’t flatter you,", "and I won’t promise jobs or money."],
  ["See it, take it with you, or have it forgotten.", "Your choice, any time."],
  ["I never train on your mind, and I never sell it."],
  ["If you’re hurting, I’ll help you reach people who can help."],
];

export type DataMode = "automatic" | "live" | "walkie";

/** Remembered on this phone: you've seen first light, your language, how Ra uses mobile data. */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`ra.${key}`);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`ra.${key}`, JSON.stringify(value));
    } catch {
      // storage off: fine for this visit
    }
  },
};

const Steps = ({ at }: { at: number }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "4px", width: "84px" }} aria-label={`Step ${at} of 5`}>
    {[2, 3, 4, 5].map((n) => (
      <span key={n} style={{ height: "3px", borderRadius: "2px", background: n <= at ? "var(--text)" : "var(--line)" }} />
    ))}
  </div>
);

export function FirstLight() {
  const [step, setStep] = useState(1);
  // J6: you can talk in more than one; the first is the one Ra starts in.
  const [langs, setLangs] = useState<string[]>(prefs.get("langs", [prefs.get("lang", "en")]));
  const lang = langs[0] ?? "en";
  const [lockProblem, setLockProblem] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  // Safety: set once, at sign-up. Under 18, beacons only ever meet others under 18.
  const [age, setAge] = useState<"under-16" | "16-17" | "adult" | null>(null);
  // A phone without passkeys (an app's WebView, an old browser) locks with a passphrase instead.
  const [usePhrase, setUsePhrase] = useState(!passkeysAvailable());
  const [phrase, setPhrase] = useState("");
  const [again, setAgain] = useState("");
  const [mic, setMic] = useState<"ask" | "allowed" | "blocked">("ask");
  const [data, setData] = useState<DataMode>(prefs.get("dataMode", "automatic"));
  const [name, setName] = useState("");

  const next = () => setStep((s) => s + 1);

  async function lock() {
    setLockProblem(null);
    setLocking(true);
    try {
      if (usePhrase && phrase !== again) throw new Error("The two passphrases don't match.");
      const { accountId } = usePhrase
        ? await registerWithPassphrase({ passphrase: phrase, ageBracket: age ?? "adult", lang })
        : await register({ ageBracket: age ?? "adult", lang });
      rememberAccount(accountId);
      // The passphrase you just chose also locks this phone's copy: no second lock screen before your first Ray.
      if (usePhrase) {
        await openVault(accountId, phrase);
        await migrateLocal();
        unlock();
        window.dispatchEvent(new Event("ra-local-ready"));
      }
      next();
    } catch (e) {
      // Say what to do, not which request failed: "/auth/passphrase/register 500" means nothing to a person.
      const own = e instanceof Error && !/^\/|\b[45]\d\d\b|fetch/i.test(e.message);
      setLockProblem(own ? (e as Error).message : navigator.onLine ? "Ra couldn't set up your lock just now. Try again in a moment." : "Setting up your lock needs a connection, just this once. Try again when you're online.");
    } finally {
      setLocking(false);
    }
  }

  async function allowMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMic("allowed");
    } catch {
      setMic("blocked");
    }
  }

  function finish() {
    prefs.set("dataMode", data);
    prefs.set("firstLight", true);
    navigate("/ray");
  }

  return (
    <div class="ui">
      {step === 1 && (
        <GlBox
          scene="ray"
          options={{ hz: 0.6, sx: 0.7, sr: 0.12, sink: 0.05, voice: "idle", rise: true }}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "404px" }}
        >
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "242px", overflow: "hidden" }}>
            <div class="orbfx" style={{ width: "201px", height: "201px", left: "calc(50% - 100px)", top: "150px" }} />
          </div>
          <div class="horizon" style={{ top: "242px" }} />
        </GlBox>
      )}
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {step === 1 && (
          // A1 · Welcome
          <>
            <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
              <span class="label">First light</span>
              <span class="label">01 / 05</span>
            </header>
            <div class="big" style={{ fontSize: "150px", marginTop: "26px", letterSpacing: "-.06em" }}>
              Ra
            </div>
            <div class="h1" style={{ fontSize: "32px", marginTop: "20px", maxWidth: "300px" }}>
              I’m Ra. Which language would you like to talk in?
            </div>
            <div class="hstack" style={{ flexWrap: "wrap", gap: "8px", marginTop: "24px" }}>
              {LANGS.map((l) => (
                <button
                  type="button"
                  key={l.code}
                  class={`pill${langs.includes(l.code) ? " on" : ""}`}
                  aria-pressed={langs.includes(l.code)}
                  style={{ height: "38px", padding: "0 15px", fontSize: "14px", border: "none", cursor: l.soon ? "default" : "pointer" }}
                  lang={l.code}
                  dir={l.rtl ? "rtl" : undefined}
                  disabled={l.soon}
                  onClick={() => {
                    const next = langs.includes(l.code) ? langs.filter((c) => c !== l.code) : [...langs, l.code];
                    if (next.length === 0) return;
                    setLangs(next);
                    prefs.set("langs", next);
                    prefs.set("lang", next[0]);
                  }}
                >
                  {l.label}
                  {l.soon && (
                    <span class="meta" style={{ fontSize: "11px" }}>
                      {" "}
                      soon
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p class="meta" style={{ margin: "14px 0 0", maxWidth: "290px" }}>
              Pick more than one if you switch. Switch mid-sentence and Ra follows. Dholuo and more are coming.
            </p>
            <div style={{ flex: 1 }} />
            <div style={{ paddingBottom: "30px" }}>
              <button type="button" class="btn btn-ink" style={{ width: "100%" }} onClick={next}>
                <Icon name="mic" size={18} /> Or just start talking
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          // A2b · Your name: what Ra calls you, from the first Ray on.
          <>
            <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
              <span class="label">Before we start</span>
              <Steps at={2} />
            </header>
            <div class="h1" style={{ marginTop: "24px" }}>
              What should I call you?
            </div>
            <p class="meta" style={{ margin: "12px 0 0", fontSize: "15px" }}>
              The name you’d like to hear. It stays in your mind, on this phone.
            </p>
            <div style={{ marginTop: "30px" }}>
              <label for="ra-name" class="label" style={{ display: "block", marginBottom: "8px" }}>
                Your name
              </label>
              <input
                id="ra-name"
                class="field"
                autocomplete="given-name"
                maxLength={40}
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && (giveName(name), next())}
                style={{ width: "100%", border: "none", boxShadow: "inset 0 0 0 1.5px var(--text)", background: "var(--surface)", font: "500 20px 'Inter Tight',sans-serif", color: "var(--text)" }}
              />
            </div>
            {name.trim() && (
              <div class="hair" style={{ marginTop: "28px", paddingTop: "18px" }}>
                <div class="hstack" style={{ gap: "10px", alignItems: "flex-start" }}>
                  <span style={{ flex: "none", width: "7px", height: "7px", marginTop: "8px", borderRadius: "50%", background: "var(--sig)", boxShadow: "0 0 10px var(--sig)" }} />
                  <p class="serif" style={{ margin: 0, fontSize: "20px", lineHeight: 1.25, fontStyle: "italic" }}>
                    Good to meet you, {name.trim()}.
                  </p>
                </div>
              </div>
            )}
            <div style={{ flex: 1 }} />
            <div class="stack" style={{ gap: "10px", paddingBottom: "30px" }}>
              <button type="button" class="btn btn-ink" style={{ width: "100%" }} disabled={!name.trim()} onClick={() => (giveName(name), next())}>
                Continue <Icon name="arrow" size={18} />
              </button>
              <button type="button" class="btn btn-line" style={{ width: "100%" }} onClick={() => (giveName(null), next())}>
                Skip for now
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          // A2 · Promises
          <>
            <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
              <span class="label">Before we start</span>
              <Steps at={3} />
            </header>
            <div class="h1" style={{ marginTop: "24px" }}>
              What you tell me is yours.
              <br />
              <span style={{ color: "var(--muted)" }}>Here’s what I promise.</span>
            </div>
            <div style={{ marginTop: "18px" }}>
              {PROMISES.map(([title, more], i) => (
                <div key={title} class="row" style={{ alignItems: "flex-start", padding: "14px 0" }}>
                  <span class="mono" style={{ fontSize: "12px", color: "var(--muted)", width: "26px", flex: "none", paddingTop: "2px" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div class="grow">
                    <div class="title" style={{ fontSize: "16px" }}>
                      {title}
                    </div>
                    {more && (
                      <div class="meta" style={{ marginTop: "3px" }}>
                        {more}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ paddingBottom: "30px" }}>
              <button type="button" class="btn btn-ink" style={{ width: "100%" }} onClick={next}>
                Lock it to this phone <Icon name="arrow" size={18} />
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          // A3 · Lock
          <>
            <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
              <span class="label">Your lock</span>
              <Steps at={4} />
            </header>
            <GlBox
            scene="lock"
            label="A lock drawn as nine broken metal rings around a glowing core. They turn on their own axes, then swing into line."
            style={{ width: "220px", height: "220px", margin: "16px auto 0", flex: "none" }}
          >
            <div style={{ position: "absolute", inset: 0 }}>
              <LockRings size={220} />
            </div>
          </GlBox>
            <div class="h1" style={{ marginTop: "20px" }}>
              Your mind sits behind a lock <span style={{ color: "var(--muted)" }}>only you hold.</span>
            </div>
            <p class="meta" style={{ margin: "12px 0 0", fontSize: "15px", maxWidth: "320px" }}>
              Use your phone’s fingerprint or screen lock. Nobody who picks up this phone can open Ra without it.
            </p>
            <div style={{ marginTop: "16px" }}>
              <div class="row">
                <Icon name="lock" size={18} />
                <span class="grow" style={{ fontSize: "14px" }}>
                  Locks after 5 minutes away
                </span>
              </div>
              <div class="row">
                <Icon name="moon" size={18} />
                <span class="grow" style={{ fontSize: "14px" }}>
                  Notifications never show what’s inside
                </span>
              </div>
              <div class="row" style={{ flexDirection: "column", alignItems: "stretch", gap: "10px", padding: "14px 0" }}>
                <div class="title" style={{ fontSize: "15px" }}>
                  How old are you?
                </div>
                <div class="seg" role="radiogroup" aria-label="How old are you?">
                  {(
                    [
                      ["under-16", "Under 16"],
                      ["16-17", "16–17"],
                      ["adult", "18 or older"],
                    ] as const
                  ).map(([k, label]) => (
                    <span key={k} role="radio" aria-checked={age === k} tabIndex={0} class={age === k ? "on" : ""} onClick={() => setAge(k)}>
                      {label}
                    </span>
                  ))}
                </div>
                <div class="meta">Only to keep you safe when you meet people through Ra. It can't be changed later.</div>
              </div>
            </div>
            {lockProblem && (
              <p class="meta" role="alert" style={{ color: "var(--accent)", margin: "12px 0 0" }}>
                {lockProblem}
              </p>
            )}
            <div style={{ flex: 1 }} />
            <div class="stack" style={{ gap: "8px", paddingBottom: "30px" }}>
              {usePhrase && (
                <>
                  <input class="field" type="password" autocomplete="new-password" aria-label="Your passphrase" placeholder="A passphrase: a few words you'll remember" value={phrase} onInput={(e) => setPhrase((e.target as HTMLInputElement).value)} style={{ border: "none", font: "400 16px 'Inter Tight',sans-serif", color: "var(--text)", background: "transparent" }} />
                  <input class="field" type="password" autocomplete="new-password" aria-label="Your passphrase again" placeholder="Once more" value={again} onInput={(e) => setAgain((e.target as HTMLInputElement).value)} style={{ border: "none", font: "400 16px 'Inter Tight',sans-serif", color: "var(--text)", background: "transparent" }} />
                </>
              )}
              <button type="button" class="btn btn-ink" onClick={lock} disabled={locking || age === null || (usePhrase ? phrase.trim().length < 10 || !again : !passkeysAvailable())}>
                {locking ? "Waiting for your lock…" : usePhrase ? "Lock it with this passphrase" : "Use fingerprint or screen lock"}
              </button>
              {passkeysAvailable() && (
                <button type="button" class="btn btn-line" onClick={() => setUsePhrase((u) => !u)}>
                  {usePhrase ? "Use fingerprint or screen lock instead" : "Use a passphrase instead"}
                </button>
              )}
            </div>
          </>
        )}

        {step === 5 && (
          // A4 · One sound
          <>
            <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
              <span class="label">One sound</span>
              <Steps at={5} />
            </header>
            <div class="h1" style={{ marginTop: "24px" }}>
              This is the only sound Ra makes.
            </div>
            <div class="card" style={{ marginTop: "18px" }}>
              <div class="spread">
                <span class="label" style={{ color: "var(--text)" }}>
                  Listening tone
                </span>
                <span class="label">0:01</span>
              </div>
              <div class="hstack" style={{ gap: "14px", marginTop: "12px" }}>
                <button type="button" class="key" aria-label="Play the listening tone" style={{ background: "var(--ink)", color: "var(--on-ink)" }} onClick={playListeningTone}>
                  <Icon name="play" size={18} />
                </button>
                <div style={{ flex: 1 }}>
                  <div class="stripes" style={{ height: "30px", alignItems: "center" }}>
                    {Array.from({ length: 40 }, (_, i) => (
                      <i key={i} style={{ height: `${6 + Math.round(20 * Math.exp(-(((i - 12) / 9) ** 2)))}px` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <p class="meta" style={{ margin: "10px 2px 0" }}>
              It plays when Ra starts listening. No chimes, no alerts, no badges.
            </p>
            <div style={{ marginTop: "14px" }}>
              <div class="row">
                <div class="grow">
                  <div class="title" style={{ fontSize: "15px" }}>
                    Microphone
                  </div>
                  <div class="meta">{mic === "blocked" ? "Blocked. You can type to Ra, or allow it later in your phone's settings." : "To talk with Ra. You can type instead."}</div>
                </div>
                {mic === "allowed" ? (
                  <span class="pill on">Allowed</span>
                ) : (
                  <button type="button" class="btn btn-ink btn-sm" onClick={allowMic}>
                    Allow
                  </button>
                )}
              </div>
              <div class="row" style={{ flexDirection: "column", alignItems: "stretch", gap: "10px", padding: "14px 0" }}>
                <div class="title" style={{ fontSize: "15px" }}>
                  On mobile data
                </div>
                <div class="seg">
                  {(
                    [
                      ["automatic", "Automatic"],
                      ["live", "Always live"],
                      ["walkie", "Walkie"],
                    ] as const
                  ).map(([k, label]) => (
                    <span key={k} class={data === k ? "on" : ""} role="button" tabIndex={0} onClick={() => setData(k)}>
                      {label}
                    </span>
                  ))}
                </div>
                <div class="meta">Live on Wi-Fi, walkie on data: one small clip per thought.</div>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ paddingBottom: "30px" }}>
              <button type="button" class="btn btn-ink" style={{ width: "100%" }} onClick={finish}>
                <Icon name="mic" size={18} /> Start my first Ray
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
