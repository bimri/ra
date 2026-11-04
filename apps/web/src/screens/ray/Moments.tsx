import { daypart, type ReadingView, type SeasonView, type SignalCard, type TripCard } from "@ra/core";
import { GlBox } from "../../sky/GlBox";
import { useEffect, useMemo } from "preact/hooks";
import { deliberate } from "../../ui/deliberate";
import { Icon } from "../../ui/icons";

// The Ray's moments, laid out as the App UI v2 boards draw them:
// B5 the mirror, B6 the window, B7 your question, B8 the trips, D2 your star,
// B10 the ring. Each can be answered by voice; taps do the same.

const Dot = () => (
  <span
    style={{
      flex: "none",
      width: "7px",
      height: "7px",
      marginTop: "9px",
      borderRadius: "50%",
      background: "var(--sig)",
      boxShadow: "0 0 10px var(--sig)",
    }}
  />
);

/** Ra's own words, in serif, after the signal dot. */
export function RaSays({ text, size = 22 }: { text: string; size?: number }) {
  return (
    <div class="hstack" style={{ gap: "10px", alignItems: "flex-start" }}>
      <Dot />
      <p class="serif" style={{ margin: 0, fontSize: `${size}px`, lineHeight: 1.25, fontStyle: "italic" }}>
        {text}
      </p>
    </div>
  );
}

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export interface MirrorItem {
  mirrorId: string;
  text: string;
  state: "offered" | "kept" | "struck";
}

/** B5: "These came up when your voice lifted. Which ones are really yours?" */
export function Mirror({ line, items, onKeep }: { line: string; items: MirrorItem[]; onKeep(id: string, keep: boolean): void }) {
  return (
    <div style={{ marginTop: "20px" }}>
      <RaSays text={line} />
      <div style={{ marginTop: "16px" }}>
        {items.map((m) => {
          const kept = m.state === "kept";
          return (
            <button
              type="button"
              key={m.mirrorId}
              class="row"
              style={{ padding: "10px 0", width: "100%", background: "none", border: "none", borderTop: "1px solid var(--line)", textAlign: "left", cursor: "pointer", color: "inherit" }}
              aria-pressed={kept}
              onClick={() => onKeep(m.mirrorId, !kept)}
            >
              <span
                style={{
                  flex: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "26px",
                  height: "26px",
                  borderRadius: "50%",
                  ...(kept
                    ? { background: "var(--ink)", color: "var(--on-ink)" }
                    : { boxShadow: "inset 0 0 0 1.5px var(--line)", color: "transparent" }),
                }}
              >
                <Check />
              </span>
              <span
                class="grow"
                style={{
                  fontSize: "18px",
                  letterSpacing: "-.02em",
                  color: kept ? "var(--text)" : "var(--muted)",
                  textDecoration: m.state === "struck" ? "line-through" : "none",
                }}
              >
                “{m.text}”
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<SignalCard["kind"], string> = {
  risen: "Risen",
  rising: "Rising",
  early: "Early",
  "stays-human": "Stays human",
  "on-ramp": "On-ramp",
};

/** B6: one thing Ra sees from where you stand, with its sources. */
export function Window({ line, signal }: { line: string; signal: SignalCard }) {
  return (
    <>
      <div class="card-line glass" style={{ marginTop: "20px" }}>
        <div class="spread">
          <span class="label">On your horizon · {KIND_LABEL[signal.kind]}</span>
          {signal.seeded && (
            <span class="label" style={{ color: "var(--faint)" }}>
              seed
            </span>
          )}
        </div>
        <div class="h2" style={{ marginTop: "10px" }}>
          {signal.text}
        </div>
        {signal.staysHuman && (
          <div class="hair" style={{ marginTop: "14px", paddingTop: "12px", fontSize: "14px" }}>
            <span class="label" style={{ marginRight: "8px" }}>
              Stays human
            </span>
            {signal.staysHuman}
          </div>
        )}
        <div class="hstack" style={{ gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
          {signal.sources.map((s) => (
            <span key={s} class="pill">
              {s}
            </span>
          ))}
        </div>
      </div>
      <div style={{ marginTop: "18px" }}>
        <RaSays text={line} />
      </div>
    </>
  );
}

/** B7: the question you came in with, struck through, and the one you're leaving with. */
export function Question({ asked, leavingWith, kept, onKeep }: { asked: string; leavingWith: string; kept: boolean; onKeep(): void }) {
  return (
    <>
      <div style={{ marginTop: "24px" }}>
        <div class="label">You came in asking</div>
        <p style={{ margin: "8px 0 0", fontSize: "20px", lineHeight: 1.25, color: "var(--muted)", textDecoration: "line-through", textDecorationColor: "var(--faint)" }}>
          {asked}
        </p>
      </div>
      <div class="hair" style={{ marginTop: "20px", paddingTop: "18px" }}>
        <div class="label" style={{ color: "var(--sig)" }}>
          {kept ? "You're leaving with · kept" : "You're leaving with"}
        </div>
        <div class="h1" style={{ marginTop: "10px", fontSize: "34px" }}>
          {leavingWith}
        </div>
      </div>
      {kept ? (
        <p class="meta" style={{ margin: "14px 0 0" }}>
          Kept, in your words.
        </p>
      ) : (
        <div class="spread" style={{ marginTop: "14px", gap: "12px" }}>
          <p class="meta" style={{ margin: 0 }}>
            Say “that’s it”, or say it your own way.
          </p>
          <button type="button" class="btn btn-line btn-sm" onClick={onKeep}>
            That's it
          </button>
        </div>
      )}
    </>
  );
}

/** Split a trip's cost into the pills B8 shows ("2 hours · no money · Wi-Fi once"). */
const costPills = (cost: string) =>
  cost
    .split(/\s*[·,;]\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

/** B8: three trips. Pick one, or change one. */
export function Trips({ trips, chosen, onChoose, onChange }: { trips: TripCard[]; chosen: string | null; onChoose(id: string): void; onChange(id: string): void }) {
  return (
    <>
      <div class="h1" style={{ marginTop: "20px", fontSize: "32px" }}>
        Pick a trip.
      </div>
      <div class="stack" style={{ gap: "10px" }}>
        {trips.map((t, i) => {
          const on = chosen === t.tripId;
          return (
            <div
              key={t.tripId}
              class="card"
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "14px",
                ...(on ? { boxShadow: "inset 0 0 0 1.5px var(--sig),0 0 0 4px color-mix(in srgb,var(--sig) 12%,transparent)" } : {}),
              }}
            >
              <div class="big" style={{ fontSize: "40px", color: on ? "var(--sig)" : "var(--faint)" }}>
                {String(i + 1).padStart(2, "0")}
              </div>
              <div>
                <button
                  type="button"
                  style={{ background: "none", border: "none", padding: 0, textAlign: "left", color: "inherit", cursor: "pointer" }}
                  onClick={() => onChoose(t.tripId)}
                >
                  <div class="title" style={{ fontSize: "16px" }}>
                    {t.title}
                  </div>
                  <div class="meta" style={{ marginTop: "4px" }}>
                    {t.tests}
                  </div>
                </button>
                <div class="hstack" style={{ gap: "6px", marginTop: "10px", flexWrap: "wrap" }}>
                  {costPills(t.cost).map((c) => (
                    <span key={c} class="pill">
                      {c}
                    </span>
                  ))}
                  {!chosen && (
                    <button type="button" class="pill" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }} onClick={() => onChange(t.tripId)}>
                      Change it
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** D2: your star, in your own words. Only you write it. */
/** D2's star: a four-point flare in the signal colour, with its halo. */
const StarArt = () => (
  <GlBox
    scene="star"
    label="Your star: a bright four-point flare with three thin orbits around it, one for each phrase it came from, in a field of far stars"
    style={{ height: "230px", margin: "6px -20px 0", flex: "none" }}
  >
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <svg width="150" height="150" viewBox="-60 -60 120 120" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <circle r="44" fill="var(--sig)" opacity=".07" />
      <circle class="halo" r="16" fill="none" stroke="var(--sig)" stroke-width=".8" />
      <circle class="halo" r="16" fill="none" stroke="var(--sig)" stroke-width=".8" style={{ animationDelay: "1.8s" }} />
      <g class="tw">
        <path d="M0 -58C1.4 -14 14 -1.4 58 0C14 1.4 1.4 14 0 58C-1.4 14 -14 1.4 -58 0C-14 -1.4 -1.4 -14 0 -58Z" fill="var(--sig)" />
        <path d="M0 -24C.8 -5 5 -.8 24 0C5 .8 .8 5 0 24C-.8 5 -5 .8 -24 0C-5 -.8 -.8 -5 0 -24Z" fill="var(--sig)" opacity=".55" transform="rotate(45)" />
        <circle r="6.5" fill="#FFF3E6" />
      </g>
    </svg>
    </div>
  </GlBox>
);

/**
 * D2: your star. Phrases that were really yours, then what you said, offered
 * back. It's written only when you say "that's my star"; "not yet" is fine (J5).
 */
export function Star({
  candidates,
  written,
  proposed,
  onKeep,
  onNotYet,
}: {
  candidates: string[];
  written: string | null;
  proposed?: string | null;
  onKeep(text: string): void;
  onNotYet(): void;
}) {
  const shown = proposed ?? written;
  return (
    <>
      <StarArt />
      <div class="hstack" style={{ justifyContent: "center", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
        {candidates.map((c) => (
          <span key={c} class="pill">
            “{c}”
          </span>
        ))}
      </div>
      {shown ? (
        <>
          <div class="h1" style={{ textAlign: "center", marginTop: "22px", fontSize: "40px" }}>
            {shown}
          </div>
          <div class="label" style={{ textAlign: "center", marginTop: "14px" }}>
            {proposed ? "In your words" : "Written by you"} · {today()}
          </div>
          <p class="meta" style={{ textAlign: "center", margin: "10px 0 0" }}>
            It's yours. Change it whenever it stops being true.
          </p>
        </>
      ) : (
        <div style={{ marginTop: "22px" }}>
          <RaSays text="Your star is yours to write. Say it in your own words, or say not yet." />
        </div>
      )}
      <div style={{ flex: 1 }} />
      {proposed ? (
        <div class="hstack" style={{ gap: "8px", paddingBottom: "30px" }}>
          <button type="button" class="btn btn-ink" style={{ flex: 1 }} onClick={() => onKeep(proposed)}>
            <Icon name="star" size={18} /> That’s my star
          </button>
          <button type="button" class="btn btn-line" onClick={onNotYet}>
            Not yet
          </button>
        </div>
      ) : (
        !written && (
          <div class="hstack" style={{ justifyContent: "flex-end", paddingBottom: "30px" }}>
            <button type="button" class="btn btn-line" onClick={onNotYet}>
              Not yet
            </button>
          </div>
        )
      )}
    </>
  );
}

/**
 * Support lines Ra may show in care (J4), by country (ISO 3166 alpha-2). Only
 * lines checked by a person go here: Ra never invents a number or a service,
 * so until a country has one, only "someone you trust" shows.
 */
export const SUPPORT_LINES: Record<string, { name: string; tel: string; hours: string }[]> = {};

function region(): string | null {
  try {
    return new Intl.Locale(navigator.language).maximize().region ?? null;
  } catch {
    return null;
  }
}

/** J4 · Care. What they said, Ra's answer, and people they can talk to now. */
export function Care({ said, line, onKeepTalking, onEnd }: { said: string; line: string | null; onKeepTalking(): void; onEnd(): void }) {
  const lines = SUPPORT_LINES[region() ?? ""] ?? [];
  return (
    <>
      <p style={{ margin: "20px 0 0", fontSize: "20px", lineHeight: 1.3, color: "var(--muted)" }}>{said}</p>
      {line && (
        <div class="hair" style={{ marginTop: "18px", paddingTop: "16px" }}>
          <RaSays text={line} size={23} />
        </div>
      )}
      <div class="label" style={{ marginTop: "22px" }}>
        People you can talk to now
      </div>
      <div>
        {lines.map((l) => (
          <div key={l.tel} class="row">
            <div class="grow">
              <div class="title" style={{ fontSize: "15px" }}>
                {l.name}
              </div>
              <div class="label" style={{ marginTop: "3px" }}>
                {l.hours}
              </div>
            </div>
            <a href={`tel:${l.tel}`} class="btn btn-ink btn-sm">
              Call
            </a>
          </div>
        ))}
        <div class="row">
          <div class="grow">
            <div class="title" style={{ fontSize: "15px" }}>
              Someone you trust
            </div>
            <div class="meta">A friend, family, a teacher</div>
          </div>
          <a href="sms:" class="btn btn-line btn-sm">
            Message
          </a>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div class="hstack" style={{ gap: "8px", paddingBottom: "30px" }}>
        <button type="button" class="btn btn-line" style={{ flex: 1 }} onClick={onKeepTalking}>
          Keep talking
        </button>
        <button type="button" class="btn btn-line" style={{ flex: 1 }} onClick={onEnd}>
          End for today
        </button>
      </div>
    </>
  );
}

/** B10: the sun is down. Your ring, in your words, and Ra's goodnight. */
/** B10b: what Ra would have them do next, shown under the ring. */
export interface RingNext {
  title: string;
  why: string;
  cta: string;
  href: string;
}

/** B10: the sun is down. Your ring, in your words, Ra's goodnight, and what's next (B10b). */
export function Ring({ session, title, text, closing, next, onNext, onGoodnight }: { session: string; title: string; text: string; closing: string; next?: RingNext | null; onNext?(href: string): void; onGoodnight(): void }) {
  // The ring arrives on its own, after the Ray: nothing on it leaves the screen unless pressed there.
  const press = useMemo(() => deliberate(Date.now()), []);
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);
  return (
    <div class="ui ray">
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            left: "-20%",
            right: "-20%",
            bottom: "118px",
            height: "190px",
            background: "radial-gradient(55% 100% at 50% 100%,color-mix(in srgb,var(--sig) 34%,transparent),transparent 72%)",
          }}
        />
        <div class="horizon" style={{ bottom: "118px" }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "118px",
            background: "linear-gradient(color-mix(in srgb,var(--sig) 10%,transparent),transparent 70%)",
          }}
        />
      </div>
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
        <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
          <span class="label">{session} · the sun is down</span>
        </header>
        <div class="label" style={{ textAlign: "center", marginTop: next ? "20px" : "40px" }}>
          {title} · {today()}
        </div>
        {text && (
          <div class="h1" style={{ textAlign: "center", fontSize: next ? "28px" : "32px", marginTop: "12px" }}>
            “{text}”
          </div>
        )}
        {closing && (
          <div class="hair" style={{ marginTop: "24px", paddingTop: "18px" }}>
            <RaSays text={closing} size={20} />
          </div>
        )}
        {next && (
          <div class="card" style={{ marginTop: "18px" }}>
            <span class="label">Next</span>
            <div class="h2" style={{ marginTop: "10px", fontSize: "21px" }}>
              {next.title}
            </div>
            <p class="meta" style={{ margin: "6px 0 0" }}>
              {next.why}
            </p>
            <button type="button" class="btn btn-ink btn-sm" style={{ marginTop: "14px" }} 
              onPointerDown={() => press.down()}
              onKeyDown={(e: KeyboardEvent) => press.key(e.key)}
              onClick={() => press.click(Date.now()) && onNext?.(next.href)}
            >
              {next.cta} <Icon name="arrow" size={16} />
            </button>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div class="spread" style={{ paddingBottom: "30px" }}>
          <span class="label">{next ? "Your ring is kept" : "Next Ray · whenever you want"}</span>
          <button type="button" class={next ? "btn btn-line" : "btn btn-ink"} onClick={onGoodnight}>
            {daypart(new Date().getHours()) === "night" ? "Goodnight" : "Done for now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function today(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const READING_PARTS: { stage: string; title: string }[] = [
  { stage: "moved", title: "What moved on your horizon" },
  { stage: "rings", title: "What your rings show" },
  { stage: "putoff", title: "One question you've been putting off" },
  { stage: "calls", title: "Calls that are due" },
];

/** F1 · the Reading: four parts, the one you're in marked "Now"; what's done is muted. */
export function ReadingAgenda({ reading, stage, onPlay }: { reading: ReadingView; stage: string; onPlay?(utteranceId: string): void }) {
  const at = READING_PARTS.findIndex((p) => p.stage === stage);
  const title = (p: (typeof READING_PARTS)[number]) => (p.stage === "calls" && reading.calls.length === 0 ? `${p.title} · none this week` : p.title);
  return (
    <>
      <div style={{ marginTop: "18px" }}>
        {READING_PARTS.map((p, i) => {
          const now = i === at;
          return (
            <div key={p.stage} class="row" style={{ minHeight: "46px", color: now ? undefined : "var(--muted)" }}>
              <span class="mono" style={{ fontSize: "12px", width: "24px" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span class="grow" style={{ fontSize: "15px", ...(now ? { color: "var(--text)", fontWeight: 500 } : {}) }}>
                {title(p)}
              </span>
              {now ? (
                <span class="pill on" style={{ height: "24px", fontSize: "11px" }}>
                  Now
                </span>
              ) : (
                i < at && <Icon name="check" size={16} />
              )}
            </div>
          );
        })}
      </div>
      {stage === "moved" && reading.horizon && (
        <div style={{marginTop:"14px"}}>
          <p class="meta">{!reading.horizon.available?"The horizon check was unavailable. This reading makes no claim about what changed.":reading.horizon.changes.length?"Sources kept with this reading":"No new sourced changes were found in this check."}</p>
          {reading.horizon.changes.map(change=>(
            <div class="card glass" key={change.id} style={{marginTop:"10px"}}>
              <p style={{margin:"0 0 8px",fontSize:"15px"}}>{change.text}</p>
              <span class="label">Read {new Date(change.at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</span>
              {change.sources.map(url=><a key={url} href={url} target="_blank" rel="noopener noreferrer" class="row" style={{fontSize:"13px",overflowWrap:"anywhere"}}>{url}</a>)}
            </div>
          ))}
        </div>
      )}
      {stage === "rings" && reading.clip && (
        <div class="card glass" style={{ marginTop: "14px" }}>
          <div class="spread">
            <span class="label" style={{ color: "var(--text)" }}>
              {reading.clip.label}
            </span>
            <span class="label">
              {Math.floor(reading.clip.ms / 60_000)}:{String(Math.floor(reading.clip.ms / 1000) % 60).padStart(2, "0")}
            </span>
          </div>
          <div class="hstack" style={{ gap: "12px", marginTop: "10px" }}>
            <button type="button" class="key" aria-label={`Play ${reading.clip.label}'s note`} style={{ width: "40px", height: "40px" }} onClick={() => onPlay?.(reading.clip!.utteranceId)}>
              <Icon name="play" size={16} />
            </button>
            <span class="meta">Hear yourself from then</span>
          </div>
        </div>
      )}
    </>
  );
}

/** K2 · the season review: route, calls, crew, star; then the season's ring. */
export function SeasonAgenda({ season, stage }: { season: SeasonView; stage: string }) {
  const rows: [string, string, string | null][] = [
    ["route", "Route", "Still pointing at your star?"],
    ["calls", "Calls", season.calls],
    ["crew", "Crew", season.crew],
    ["star", "Star", "Has it moved?"],
  ];
  return (
    <>
      <div style={{ marginTop: "16px" }}>
        {rows
          .filter(([, , text]) => text !== null)
          .map(([key, label, text]) => (
            <div key={key} class="row" style={{ alignItems: "flex-start", padding: "13px 0", color: key === stage ? undefined : "var(--muted)" }}>
              <span class="label" style={{ width: "86px", flex: "none", paddingTop: "3px" }}>
                {label}
              </span>
              <div class="grow" style={{ fontSize: "15px", lineHeight: 1.4 }}>
                {key === "star" ? (
                  <span class="accent" style={{ fontSize: "18px" }}>
                    {text}
                  </span>
                ) : (
                  <span style={key === stage ? { color: "var(--text)" } : undefined}>{text}</span>
                )}
              </div>
            </div>
          ))}
      </div>
      <p class="meta" style={{ margin: "14px 0 0" }}>
        {season.ring}
      </p>
    </>
  );
}
