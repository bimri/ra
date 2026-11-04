import { STARS, type Accent, type StarKind, type ThemeName } from "../../ui/theme";
import { setTheme, useTheme } from "../../ui/themeStore";
import { GlBox } from "../../sky/GlBox";
import { Icon } from "../../ui/icons";
import { go } from "../../ui/nav";
import { Tip } from "../../ui/Tooltip";

// U6 · Appearance: make Ra yours. Theme, signal colour, your sun, corners.

const THEMES: { name: ThemeName; label: string; bg: string; ink: string; sun: string }[] = [
  { name: "paper", label: "Paper", bg: "#ECEBE7", ink: "#0C0C0C", sun: "#FF5A1F" },
  { name: "ink", label: "Ink", bg: "#0A0A0A", ink: "#F2F1EE", sun: "#FF5A1F" },
  { name: "signal", label: "Signal", bg: "#F2C230", ink: "#0C0C0C", sun: "#FFFFFF" },
];

const ACCENTS: { name: Accent; color: string }[] = [
  { name: "orange", color: "#FF5A1F" },
  { name: "cobalt", color: "#2F4BE0" },
  { name: "yellow", color: "#F2C230" },
  { name: "red", color: "#E5322D" },
  { name: "green", color: "#2F8F5B" },
];

const SUN_ORDER: StarKind[] = ["signal", "yellow", "orange", "red-dwarf", "white-dwarf", "blue-giant", "red-giant"];

export function AppearanceScreen() {
  const theme = useTheme();
  const star = STARS[theme.star];
  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <header class="hstack" style={{ minHeight: "44px", gap: "6px" }}>
          <Tip text="Back"><a href="/" onClick={go("/")} class="key" aria-label="Back" style={{ width: "40px", height: "40px", background: "transparent", boxShadow: "none", color: "var(--text)" }}>
            <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
              <Icon name="arrow" size={20} />
            </span>
          </a></Tip>
          <span class="label">Appearance</span>
        </header>

        <div class="card" style={{ marginTop: "16px", position: "relative", overflow: "hidden", height: "170px", padding: 0 }}>
          <GlBox
            scene="ray"
            options={{ hz: 0.68, sx: 0.76, sr: 0.085, sink: 0.2, voice: "calm", fov: 30, cell: 0.09, bg: "surface" }}
            style={{ position: "absolute", inset: 0 }}
          >
            <div class="orbfx" style={{ width: "150px", height: "150px", right: "-20px", top: "40px" }} />
          </GlBox>
          <div style={{ position: "absolute", inset: 0, padding: "var(--pad)", display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none" }}>
            <div>
              <div class="label">Preview · {THEMES.find((t) => t.name === theme.name)?.label}</div>
              <div class="h2" style={{ marginTop: "10px", maxWidth: "200px" }}>
                Read the fault codes first.
              </div>
            </div>
            <div class="hstack">
              <span class="btn btn-ink btn-sm">
                <Icon name="mic" size={16} /> Bring it back
              </span>
              <span class="pill" style={{ background: "color-mix(in srgb,var(--surface) 70%,transparent)" }}>
                <span class="d" />
                Day 1 / 2
              </span>
            </div>
          </div>
        </div>

        <div class="spread" style={{ marginTop: "18px" }}>
          <span class="label">Your sun</span>
          <span class="mono" style={{ fontSize: "10.5px", color: "var(--text)" }}>
            {star.name} · {theme.star === "signal" ? "Your colour" : star.tag}
          </span>
        </div>
        <div class="spread" style={{ marginTop: "10px" }}>
          {SUN_ORDER.map((k) => {
            const c = STARS[k].color ?? ACCENTS.find((a) => a.name === theme.accent)!.color;
            return (
              <Tip key={k} text={STARS[k].name}><button
                type="button"
                class={`sunsw${theme.star === k ? " on" : ""}`}
                aria-label={STARS[k].name}
                aria-pressed={theme.star === k}
                onClick={() => setTheme({ star: k })}
              >
                <i style={{ width: "22px", height: "22px", background: `radial-gradient(circle at 40% 38%, #FFF8EF, ${c} 55%, transparent 75%)` }} />
              </button></Tip>
            );
          })}
        </div>

        <div class="label" style={{ marginTop: "20px" }}>
          Theme
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px", marginTop: "10px" }}>
          {THEMES.map((t) => (
            <button
              type="button"
              key={t.name}
              aria-pressed={theme.name === t.name}
              onClick={() => setTheme({ name: t.name })}
              style={{ background: "none", border: "none", padding: 0, textAlign: "left", color: "inherit", cursor: "pointer" }}
            >
              <div
                style={{
                  height: "72px",
                  borderRadius: "var(--r-sm)",
                  background: t.bg,
                  position: "relative",
                  overflow: "hidden",
                  boxShadow: theme.name === t.name ? "0 0 0 2px var(--bg),0 0 0 3.5px var(--text)" : "inset 0 0 0 1px var(--line)",
                }}
              >
                <div style={{ position: "absolute", right: "-14px", top: "-14px", width: "44px", height: "44px", borderRadius: "50%", background: `radial-gradient(circle,#FFF1E2 0,${t.sun} 45%,transparent 72%)` }} />
                <div style={{ position: "absolute", left: "10px", top: "12px", width: "48px", height: "7px", borderRadius: "2px", background: t.ink }} />
                <div style={{ position: "absolute", left: "10px", top: "24px", width: "32px", height: "7px", borderRadius: "2px", background: t.ink, opacity: 0.5 }} />
                <div style={{ position: "absolute", left: "10px", bottom: "10px", width: "30px", height: "12px", borderRadius: "6px", background: t.ink }} />
              </div>
              <div class="title" style={{ fontSize: "13px", marginTop: "6px" }}>
                {t.label}
              </div>
            </button>
          ))}
        </div>

        <div style={{ marginTop: "12px", marginBottom: "24px" }}>
          <div class="row">
            <div class="grow title" style={{ fontSize: "15px" }}>
              Signal colour
            </div>
            <div class="hstack" style={{ gap: "9px" }}>
              {ACCENTS.map((a) => (
                <button
                  type="button"
                  key={a.name}
                  class={`swatch${theme.accent === a.name ? " on" : ""}`}
                  style={{ background: a.color, border: "none", cursor: "pointer" }}
                  aria-label={a.name}
                  aria-pressed={theme.accent === a.name}
                  onClick={() => setTheme({ accent: a.name })}
                />
              ))}
            </div>
          </div>
          <div class="row" style={{ flexDirection: "column", alignItems: "stretch", gap: "9px", padding: "13px 0" }}>
            <div class="spread">
              <label for="motion" class="title" style={{ fontSize: "15px" }}>
                Motion
              </label>
              <span class="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
                calm · · · lively
              </span>
            </div>
            <div class="meter" style={{ height: "14px", borderRadius: "7px", background: "color-mix(in srgb,var(--text) 8%,transparent)", position: "relative" }}>
              <i class="dither" style={{ width: `${(theme.motion ?? 3) * 25}%`, borderRadius: "7px" }} />
              <span style={{ position: "absolute", top: "1px", left: `calc(${(theme.motion ?? 3) * 25}% - ${(theme.motion ?? 3) === 0 ? 0 : 13}px)`, width: "12px", height: "12px", borderRadius: "50%", background: "var(--text)", boxShadow: "0 0 0 3px var(--bg)" }} />
              <input id="motion" type="range" min={0} max={4} step={1} value={theme.motion ?? 3} aria-valuetext={["Calm", "Slow", "Gentle", "Lively", "Very lively"][theme.motion ?? 3]} onInput={(e) => setTheme({ motion: Number(e.currentTarget.value) as 0 | 1 | 2 | 3 | 4 })} style={{ position: "absolute", inset: "-8px 0", width: "100%", opacity: 0, cursor: "pointer", margin: 0 }} />
            </div>
          </div>
          <div class="row">
            <div class="grow title" style={{ fontSize: "15px" }}>
              Corners
            </div>
            <div class="seg">
              {(["soft", "round", "crisp"] as const).map((c) => (
                <span key={c} class={theme.corners === c ? "on" : ""} role="button" tabIndex={0} onClick={() => setTheme({ corners: c })}>
                  {c[0]!.toUpperCase() + c.slice(1)}
                </span>
              ))}
            </div>
          </div>
          <div class="row">
            <div class="grow title" style={{ fontSize: "15px" }}>
              Sky
            </div>
            <div class={`switch${theme.sky ? " on" : ""}`} role="switch" aria-checked={theme.sky} tabIndex={0} onClick={() => setTheme({ sky: !theme.sky })} />
          </div>
        </div>
      </div>
    </div>
  );
}
