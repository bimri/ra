import { currentIsland, nextFor, runningTrip, sinceLastVisit, tripDay, TRIP_DAYS, type EventKind, type Views } from "@ra/core";
import { useEffect, useState } from "preact/hooks";
import { useQueuedClips } from "../../store/clips";
import { sendOwedEnd } from "../../store/rayEnd";
import { useMind } from "../../store/mind";
import { Dock } from "../../ui/Dock";
import { GlBox } from "../../sky/GlBox";
import { Icon } from "../../ui/icons";
import { Tip, InfoTip, GLOSSARY } from "../../ui/Tooltip";
import { go } from "../../ui/nav";
import { GrowthRings } from "../../ui/art/GrowthRings";
import { clock, sunset } from "../../ui/sun";

// U3 · Today. Everything here is computed from your Mind's events by the
// shared reducer: the heading, your trip, your rings, the Watch's night.

/** When you last had Today open, for "Since you were here" (U3b). Kept on this phone only. */
function lastSeen(): number {
  try {
    return Number(localStorage.getItem("ra.lastSeen")) || 0;
  } catch {
    return 0;
  }
}
function seenNow(): void {
  try {
    localStorage.setItem("ra.lastSeen", String(Date.now()));
  } catch {
    // storage off: everything reads as new, which is harmless
  }
}

/** U3b: "Morning, Amani." */
function greeting(now: number): string {
  const h = new Date(now).getHours();
  return h < 5 ? "Evening" : h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

interface Today {
  heading: string;
  /** No trip under way, and the last one was brought back (C3). */
  broughtBack: boolean;
  trip: { title: string; day: number } | null;
  island: string | null;
  rings: number;
  lastRing: number | null;
  /** Rays in each of the last twelve months, oldest first (the card's growth rings). */
  months: number[];
  /** Which of those months your latest landfall fell in; -1 for none. */
  landfallMonth: number;
  landfallAt: number | null;
  night: { time: string; text: string }[];
}

function monthsAgo(at: number, now: number): number {
  const a = new Date(at), b = new Date(now);
  return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
}

function today(v: Views, now: number): Today {
  // The heading: the newest line the Watch or the dawn left, else your chosen trip's first step,
  // else your star, in your own words.
  const trips = Object.values(v.trips);
  const trip = runningTrip(v);
  const broughtBack = !trip && trips.some((t) => t.state === "reported");
  const line = v.today.at(-1);
  const heading =
    line?.text ??
    (trip ? trip.action.split(/(?<=[.!?])\s/)[0]! : (v.star.current ?? (Object.keys(v.rays).length ? "Your trips are on their way." : "Start your first Ray.")));
  const nights = Object.keys(v.nightLogs).sort();
  const lastNight = nights.at(-1);
  return {
    heading,
    broughtBack,
    trip: trip ? { title: trip.title ?? trip.action, day: Math.min(TRIP_DAYS, tripDay(trip.chosenAt ?? now, now)) } : null,
    island: currentIsland(v),
    rings: v.rings.length,
    lastRing: v.rings.at(-1)?.at ?? null,
    months: Array.from({ length: 12 }, (_, i) => Object.values(v.rays).filter((r) => monthsAgo(r.startedAt, now) === 11 - i).length),
    landfallMonth: v.landfalls.length ? 11 - monthsAgo(v.landfalls.at(-1)!.at, now) : -1,
    landfallAt: v.landfalls.at(-1)?.at ?? null,
    night: lastNight ? v.nightLogs[lastNight]!.map((l) => ({ time: l.slice(0, 5), text: l.slice(6) || l })) : [],
  };
}

/** J2 "Waiting to send": what each kind of thing made on this phone is called. */
const WAITING: Partial<Record<EventKind, string>> = {
  "dial.call": "Your call on the Dial",
  "memory.corrected": "A change to what Ra remembers",
  "mirror.kept": "A quote you kept",
  "mirror.struck": "A quote you struck",
  "trip.chosen": "The trip you chose",
  "star.written": "Your star",
  "star.revised": "Your star",
};

/** "two hours ago": how old this phone's copy of today is (J2). */
function ago(at: number | null, now: number): string {
  if (at === null) return "before you went offline";
  const min = Math.round((now - at) / 60_000);
  if (min < 2) return "a moment ago";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h === 1 ? "an hour" : `${h} hours`} ago` : "more than a day ago";
}

export function TodayScreen() {
  const { views, pending, online, syncedAt } = useMind();
  const clips = useQueuedClips();
  const waiting = pending.length + clips.length;
  const now = Date.now();
  const t = today(views, now);
  const live = views.liveRay !== null && views.rays[views.liveRay]?.endedAt === null;
  const dusk = sunset(new Date(now));
  const name = views.person?.name ?? null;
  // What happened since you last looked: read once as Today opens, then this visit counts as seen.
  const [since] = useState(() => lastSeen());
  useEffect(() => {
    const hidden = () => document.visibilityState === "hidden" && seenNow();
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      seenNow();
    };
  }, []);
  // The heading already says the newest line; the list never repeats it.
  // A Ray you ended offline: tell the Mind now, so Today stops offering to continue it.
  useEffect(() => sendOwedEnd(), [views.seq]);
  const away = since ? sinceLastVisit(views, since, now, 4).filter((a) => a.text !== t.heading).slice(0, 3) : [];
  const steps = nextFor(views, now);
  const next = steps[0]!;
  const date = new Date(now).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", " ·");
  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: "0 0 84px 0", padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <header class="spread" style={{ minHeight: "44px" }}>
          {/* Ra's mark opens your mind (I1). */}
          <a href="/mind" onClick={go("/mind")} class="hstack" aria-label="Your mind" style={{ gap: "7px", color: "var(--text)" }}>
            <Icon name="today" strokeWidth={1.6} />
            <span style={{ fontWeight: 600, fontSize: "20px", letterSpacing: "-.04em" }}>Ra</span>
          </a>
          <div class="hstack" style={{ gap: "6px" }}>
            <span class="label">{date}</span>
            <Tip text="Appearance"><a href="/appearance" onClick={go("/appearance")} class="key" aria-label="Appearance" style={{ width: "40px", height: "40px", background: "transparent", boxShadow: "none", color: "var(--text)" }}>
              <Icon name="settings" size={20} />
            </a></Tip>
          </div>
        </header>

        {(!online || waiting > 0) && (
          // J2: offline, everything still works; what's waiting goes when you reconnect.
          <div class="pill" style={{ marginTop: "12px", alignSelf: "flex-start" }}>
            <span class="d" />
            {online ? `${waiting} kept on this phone` : "Offline"}
          </div>
        )}

        {online ? (
          <div style={{ marginTop: "22px" }}>
            {name ? (
              <>
                <div class="h1" style={{ fontSize: "44px" }}>
                  {greeting(now)}, {name}.
                </div>
                <div class="h1" style={{ fontSize: "44px", color: "var(--muted)", maxWidth: "340px" }}>
                  {t.heading}
                </div>
              </>
            ) : (
              <>
                <div class="label">Today's heading</div>
                <div class="h1" style={{ fontSize: "44px", marginTop: "10px", maxWidth: "320px" }}>
                  {t.heading}
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ marginTop: "26px" }}>
            <div class="h1" style={{ fontSize: "40px", maxWidth: "320px" }}>
              You’re offline. Everything still works.
            </div>
            <p class="meta" style={{ margin: "10px 0 0" }}>
              Today is from {ago(syncedAt, now)}. It catches up when you reconnect.
            </p>
            {waiting > 0 && (
              <div style={{ marginTop: "16px" }}>
                <div class="spread">
                  <span class="label">Waiting to send</span>
                  <span class="mono" style={{ fontSize: "12px" }}>
                    {waiting}
                  </span>
                </div>
                {clips.map((c) => (
                  <div key={c.id} class="row" style={{ minHeight: "44px" }}>
                    <span class="grow" style={{ fontSize: "14px" }}>
                      {c.label}
                    </span>
                    <span class="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
                      {Math.floor(c.ms / 60_000)}:{String(Math.floor(c.ms / 1000) % 60).padStart(2, "0")}
                    </span>
                  </div>
                ))}
                {pending.map((d) => (
                  <div key={d.id} class="row" style={{ minHeight: "44px" }}>
                    <span class="grow" style={{ fontSize: "14px" }}>
                      {WAITING[d.kind] ?? "Something you did here"}
                    </span>
                    <span class="label">queued</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!online && t.trip && (
          // J2: your trip waits with you; bringing it back works offline and sends later.
          <div class="card" style={{ marginTop: "18px" }}>
            <div class="label">Scouting trip · day {t.trip.day} of {TRIP_DAYS}</div>
            <div class="h2" style={{ marginTop: "8px" }}>
              {t.trip.title}
            </div>
            <a href="/bring-back" onClick={go("/bring-back")} class="btn btn-ink btn-sm" style={{ marginTop: "14px" }}>
              <Icon name="mic" size={16} /> Bring it back · it’ll wait
            </a>
          </div>
        )}

        {online && (
          <>
        {away.length > 0 && (
          // U3b: since you were here, newest first.
          <div style={{ marginTop: "22px" }}>
            <div class="label" style={{ marginBottom: "6px" }}>
              Since you were here
            </div>
            {away.map((a) => {
              const row = (
                <>
                  <span class="t">{new Date(a.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  <div class="grow">
                    <div class="title" style={{ fontSize: "15px" }}>
                      {a.text}
                    </div>
                  </div>
                  {a.href && <Icon name="arrow" size={16} />}
                </>
              );
              return a.href ? (
                <a key={a.kind + a.at} href={a.href} onClick={go(a.href)} class="row" style={{ color: "inherit" }}>
                  {row}
                </a>
              ) : (
                <div key={a.kind + a.at} class="row">
                  {row}
                </div>
              );
            })}
          </div>
        )}

        {/* U3b: the one thing Ra would do next, and a Ray beside it. */}
        <div class="card" style={{ marginTop: "18px" }}>
          <span class="label">Next</span>
          <div class="h2" style={{ marginTop: "10px" }}>
            {next.title}
          </div>
          <p class="meta" style={{ margin: "6px 0 0" }}>
            {next.why}
          </p>
          <div class="hstack" style={{ marginTop: "14px", gap: "8px", flexWrap: "wrap" }}>
            <a href={next.href} onClick={go(next.href)} class="btn btn-ink btn-sm">
              {next.cta} <Icon name="arrow" size={16} />
            </a>
            {next.href.split("?")[0] !== "/ray" && (
              <a href="/ray" onClick={go("/ray")} class="btn btn-line btn-sm">
                <Icon name="ray" size={16} /> {live ? "Continue your Ray" : "Start a Ray"}
              </a>
            )}
          </div>
        </div>

        <div class="grid3 hair" style={{ marginTop: "20px" }}>
          <div>
            <div class="label">Trip</div>
            <div class="title" style={{ marginTop: "6px" }}>
              {t.trip ? `Day ${t.trip.day} / ${TRIP_DAYS}` : t.broughtBack ? "Brought back" : "None yet"}
            </div>
            {t.trip && (
              <div class="meter" style={{ marginTop: "8px", height: "4px" }}>
                <i class="dither" style={{ width: `${(t.trip.day / TRIP_DAYS) * 100}%` }} />
              </div>
            )}
          </div>
          <div>
            <div class="label">Island</div>
            <div class="title" style={{ marginTop: "6px" }}>
              {t.island ?? "Not yet"}
            </div>
          </div>
          <div>
            <div class="label">Next Ray</div>
            <div class="title" style={{ marginTop: "6px" }}>
              {t.trip ? "When you're back" : "Whenever you want"}
            </div>
          </div>
        </div>


        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "22px" }}>
          <div class="card" style={{ padding: 0, height: "184px", position: "relative", overflow: "hidden" }}>
            <GlBox
              scene="ray"
              options={{ hz: 0.6, sx: 0.68, sr: 0.105, sink: 0.25, voice: "calm", fov: 32, cell: 0.085, bg: "surface" }}
              style={{ position: "absolute", inset: 0 }}
            >
              <div class="orbfx" style={{ width: "120px", height: "120px", left: "calc(50% - 60px)", top: "70px" }} />
              <div class="horizon" style={{ top: "130px" }} />
            </GlBox>
            <div style={{ position: "absolute", inset: 0, padding: "14px", display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none" }}>
              <span class="label">Daylight</span>
              <div>
                {dusk && (
                  <div class="dot" style={{ fontSize: "26px", lineHeight: 1 }}>
                    {clock(dusk)}
                  </div>
                )}
                <div class="meta" style={{ fontSize: "12px", marginTop: "3px" }}>
                  {dusk ? "sunset · Ray at dusk" : "a Ray at dusk"}
                </div>
              </div>
            </div>
          </div>
          <a href="/rings" onClick={go("/rings")} class="card" style={{ height: "184px", display: "flex", flexDirection: "column", justifyContent: "space-between", textDecoration: "none", color: "inherit", padding: "14px" }}>
            <div class="spread">
              <span class="label">Rings</span>
              <Icon name="arrow" size={16} />
            </div>
            <div style={{ alignSelf: "center" }}>
              <GrowthRings
                counts={t.months}
                landfall={t.landfallMonth}
                label={t.landfallMonth >= 0 ? "Twelve growth rings, one per month; your landfall month's ring is in the signal colour" : "Twelve growth rings, one per month; the wider the ring, the more Rays that month"}
              />
            </div>
            <div class="spread" style={{ alignItems: "flex-end" }}>
              <span class="big" style={{ fontSize: "28px" }}>
                {String(t.rings).padStart(2, "0")}
              </span>
              <span class="meta" style={{ fontSize: "12px" }}>
                {t.landfallAt ? `landfall · ${new Date(t.landfallAt).toLocaleDateString("en-GB", { month: "short" })}` : t.lastRing ? `last · ${new Date(t.lastRing).toLocaleDateString("en-GB", { month: "short" })}` : "none yet"}
              </span>
            </div>
          </a>
        </div>

        <div style={{ margin: "20px 0 24px" }}>
          <span class="hstack" style={{ gap: "6px", marginBottom: "6px" }}><a href="/watch" onClick={go("/watch")} class="label">From the night</a><InfoTip label="About the Watch" text={GLOSSARY.watch} /></span>
          {t.night.length ? (
            t.night.map((n) => (
              <div class="row" key={n.time + n.text}>
                <span class="t">{n.time}</span>
                <div class="grow">
                  <div class="title" style={{ fontSize: "15px" }}>
                    {n.text}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div class="row">
              <div class="grow meta">The Watch reads overnight.</div>
            </div>
          )}
        </div>
          </>
        )}
      </div>
      <Dock here="/" />
    </div>
  );
}
