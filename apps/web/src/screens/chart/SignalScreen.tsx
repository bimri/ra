import { useMind } from "../../store/mind";
import { useHorizon, KIND_LABEL, ON_THE_HORIZON } from "../../store/horizon";
import { BackHeader } from "../../ui/BackHeader";
import { Icon } from "../../ui/icons";
import { go, navigate } from "../../ui/nav";
import {verifiedHorizon} from "@ra/core";

// E3 · Signal: one signal on your horizon, what's known about it and where
// it comes from. Timing that's uncertain goes on your Dial.

/** "Energy agency report · Oct 2026" → name and date. */
function source(s: string): [string, string] {
  const i = s.lastIndexOf(" · ");
  return i > 0 ? [s.slice(0, i), s.slice(i + 3)] : [s, ""];
}

export function SignalScreen() {
  const horizon = useHorizon();
  const { views } = useMind();
  const id = new URLSearchParams(location.search).get("id");
  const signals = horizon?.signals ?? [];
  const s = signals.find((x) => x.id === id);
  const n = s ? ON_THE_HORIZON.indexOf(s.kind) + 1 : 0;
  const onDial = Object.keys(views.dial).length > 0;

  const rows: [string, preact.ComponentChildren][] = s
    ? [
        ...(s.direction ? [["Direction", s.direction] as [string, string]] : []),
        ...(s.timing
          ? [
              [
                "Timing",
                <>
                  {s.timing}{" "}
                  {onDial && (
                    <>
                      It’s on your{" "}
                      <a href="/chart/dial" onClick={go("/chart/dial")} class="accent" style={{ textDecoration: "underline" }}>
                        Dial
                      </a>
                      .
                    </>
                  )}
                </>,
              ] as [string, preact.ComponentChildren],
            ]
          : []),
        ...(s.staysHuman ? [["Stays human", s.staysHuman] as [string, string]] : []),
      ]
    : [];

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div class="spread">
          <BackHeader to="/chart/horizon" title={s ? n?`Signal ${n}`:KIND_LABEL[s.kind]??"Signal" : "Signal"} purpose="One change in the world near your star, and its sources." />
          {s && (
            <span class="pill">
              <span class="d" />
              {KIND_LABEL[s.kind]}
            </span>
          )}
        </div>
        {!s ? (
          <p class="meta" style={{ margin: "18px 0 0" }}>
            {horizon ? "This signal has left your horizon." : "Reading your horizon…"}
          </p>
        ) : (
          <>
            <div class="h1" style={{ marginTop: "18px", fontSize: "32px" }}>
              {s.text}
            </div>
            {rows.length > 0 && (
              <div style={{ marginTop: "14px" }}>
                {rows.map(([label, value]) => (
                  <div key={label} class="row" style={{ alignItems: "flex-start", padding: "13px 0" }}>
                    <span class="label" style={{ width: "86px", flex: "none", paddingTop: "3px" }}>
                      {label}
                    </span>
                    <div class="grow" style={{ fontSize: "15px", lineHeight: 1.4 }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div class="label" style={{ marginTop: "16px" }}>
              Sources{s.seeded ? " · seed, not yet read by Wonder" : verifiedHorizon(s,Date.now())?" · evidence checked":" · source check needed"}
            </div>
            <div>
              {verifiedHorizon(s,Date.now(),Number.MAX_SAFE_INTEGER)&&s.verification?.documents.map(document=><div class="hair" key={document.url} style={{padding:"12px 0"}}><p class="meta">“{document.quote}”</p><a href={document.url} target="_blank" rel="noopener noreferrer" class="accent" style={{overflowWrap:"anywhere",fontSize:"13px"}}>Open source</a><p class="meta">Checked {new Date(document.checkedAt).toLocaleDateString("en-GB")}. Publication date unknown.</p></div>)}
              {s.sources.map((src) => {
                const [name, when] = source(src);
                return (
                  <div key={src} class="row" style={{ minHeight: "44px" }}>
                    <span class="grow" style={{ fontSize: "14px" }}>
                      {name}
                    </span>
                    {when && (
                      <span class="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
                        {when}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div style={{ flex: 1, minHeight: "20px" }} />
        {s && (
          <div style={{ paddingBottom: "30px" }}>
            <button type="button" class="btn btn-ink" style={{ width: "100%" }} onClick={() => navigate(`/ray?signal=${encodeURIComponent(s.text)}`)}>
              <Icon name="mic" size={18} /> What do you make of it?
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
