// One theme store: Paper, Ink or Signal, the signal colour, and your chosen
// Star. Values are App UI v2's (U0 Tokens, U6 Appearance). They feed the CSS
// variables now and the sky scene's uniforms once it's ported.

export type ThemeName = "paper" | "ink" | "signal";
export type Accent = "orange" | "cobalt" | "yellow" | "red" | "green";
export type StarKind = "signal" | "yellow" | "orange" | "red-dwarf" | "white-dwarf" | "blue-giant" | "red-giant";

export interface Theme {
  name: ThemeName;
  accent: Accent;
  star: StarKind;
  corners: "soft" | "round" | "crisp";
  density: "comfortable" | "compact";
  sky: boolean;
  /** U6 Motion, calm (0) to lively (4): how fast the sky and the ambient marks move. */
  motion: 0 | 1 | 2 | 3 | 4;
}

/** Motion step to speed: calm holds still, lively runs a little quicker than the boards. */
export const MOTION_SPEED = [0, 0.4, 0.7, 1, 1.35] as const;

// Paper is App UI v2's default on every board; Ink and Signal are choices in Appearance (U6).
export const DEFAULT_THEME: Theme = {
  name: "paper",
  accent: "orange",
  star: "signal",
  corners: "soft",
  density: "comfortable",
  sky: true,
  motion: 3,
};

const ACCENTS: Record<Accent, string> = {
  orange: "#FF5A1F",
  cobalt: "#2F4BE0",
  yellow: "#F2C230",
  red: "#E5322D",
  green: "#2F8F5B",
};
const ON_ACCENT: Record<Accent, string> = {
  orange: "#0C0C0C",
  cobalt: "#FFFFFF",
  yellow: "#0C0C0C",
  red: "#FFFFFF",
  green: "#FFFFFF",
};

export const STARS: Record<StarKind, { name: string; tag: string; color: string | null }> = {
  signal: { name: "Signal sun", tag: "Signal sun", color: null },
  yellow: { name: "Yellow dwarf", tag: "G2V · 5,772 K", color: "#FFB13B" },
  orange: { name: "Orange dwarf", tag: "K5V · 4,400 K", color: "#FF8233" },
  "red-dwarf": { name: "Red dwarf", tag: "M5V · 3,000 K", color: "#E0402A" },
  "white-dwarf": { name: "White dwarf", tag: "DA · 25,000 K", color: "#A8C2FF" },
  "blue-giant": { name: "Blue giant", tag: "B0 III · 30,000 K", color: "#7EA4FF" },
  "red-giant": { name: "Red giant", tag: "K5 III · 3,900 K", color: "#C7371D" },
};

export function tokens(t: Theme): Record<string, string> {
  const acc = ACCENTS[t.accent];
  const on = ON_ACCENT[t.accent];
  let v: Record<string, string>;
  if (t.name === "paper") {
    v = { bg: "#ECEBE7", surface: "#F7F6F3", surface2: "#E1E0DB", line: "rgba(12,12,12,0.12)", text: "#0C0C0C", muted: "#6F6E6A", faint: "#A3A29D", accent: acc, "on-accent": on, ink: "#0C0C0C", "on-ink": "#F7F6F3", hi: "rgba(255,255,255,0.8)" };
  } else if (t.name === "ink") {
    v = { bg: "#0A0A0A", surface: "#141414", surface2: "#1E1E1E", line: "rgba(255,255,255,0.10)", text: "#F2F1EE", muted: "#8C8B87", faint: "#52514D", accent: acc, "on-accent": on, ink: "#F2F1EE", "on-ink": "#0A0A0A", hi: "rgba(255,255,255,0.06)" };
  } else {
    const dk = on === "#0C0C0C";
    const mix = dk ? "#FFFFFF" : "#000000";
    v = {
      bg: acc,
      surface: `color-mix(in srgb, ${acc} 82%, ${mix})`,
      surface2: `color-mix(in srgb, ${acc} 70%, ${mix})`,
      line: dk ? "rgba(12,12,12,0.16)" : "rgba(255,255,255,0.18)",
      text: on,
      muted: dk ? "rgba(12,12,12,0.62)" : "rgba(255,255,255,0.7)",
      faint: dk ? "rgba(12,12,12,0.38)" : "rgba(255,255,255,0.42)",
      accent: on,
      "on-accent": acc,
      ink: on,
      "on-ink": acc,
      hi: "rgba(255,255,255,0.28)",
    };
  }
  const r = { soft: 20, round: 28, crisp: 4 }[t.corners];
  const compact = t.density === "compact";
  const star = STARS[t.star];
  return {
    ...v,
    r: `${r}px`,
    "r-sm": `${Math.max(2, Math.round(r * 0.6))}px`,
    pad: `${compact ? 14 : 18}px`,
    gap: `${compact ? 10 : 14}px`,
    "row-h": `${compact ? 48 : 58}px`,
    orb: t.sky ? "block" : "none",
    ms: String(MOTION_SPEED[t.motion ?? 3] || 1),
    sig: acc,
    "orb-c": star.color ?? (t.name === "signal" ? "#FFFFFF" : acc),
  };
}

export function colorScheme(t: Theme): "light" | "dark" {
  if (t.name === "paper") return "light";
  if (t.name === "ink") return "dark";
  return ON_ACCENT[t.accent] === "#0C0C0C" ? "light" : "dark";
}

export function applyTheme(t: Theme, el: HTMLElement = document.documentElement): void {
  for (const [k, value] of Object.entries(tokens(t))) el.style.setProperty(`--${k}`, value);
  el.style.colorScheme = colorScheme(t);
  el.dataset.motion = String(t.motion ?? 3);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", tokens(t).bg ?? "#0A0A0A");
}

/** The colours a sky scene draws with (the canvas's `_c`): from the same theme as the CSS. */
export interface SceneColours {
  bg: string;
  surface: string;
  text: string;
  sig: string;
  hi: string;
  /** The sun's glow. */
  gl: string;
  /** Highlights on the water. */
  hl: string;
  dark: boolean;
  /** "Sky" on: the sun and stars draw; off, the flat fallback only. */
  sun: boolean;
  star: StarKind;
}

export function sceneColours(t: Theme): SceneColours {
  const acc = ACCENTS[t.accent];
  const on = ON_ACCENT[t.accent];
  const paper = t.name === "paper";
  const ink = t.name === "ink";
  return {
    bg: paper ? "#ECEBE7" : ink ? "#0A0A0A" : acc,
    surface: paper ? "#F7F6F3" : ink ? "#141414" : acc,
    text: paper ? "#0C0C0C" : ink ? "#F2F1EE" : on,
    sig: acc,
    hi: "#FFF3E6",
    gl: ink ? "#FFE7D2" : acc,
    hl: t.name === "signal" ? "#FFFFFF" : acc,
    dark: ink || (t.name === "signal" && on !== "#0C0C0C"),
    sun: t.sky,
    star: t.star,
  };
}
