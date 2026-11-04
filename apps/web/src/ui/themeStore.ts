import { useEffect, useState } from "preact/hooks";
import { DEFAULT_THEME, applyTheme, type Theme } from "./theme";

// Your appearance, kept on this phone. It feeds the CSS variables now and the
// sky's uniforms once the scenes are ported, so the sun, the sea's glints and
// the flat orb always agree.

const KEY = "ra.theme";
const listeners = new Set<(t: Theme) => void>();

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_THEME, ...(JSON.parse(raw) as Partial<Theme>) } : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function setTheme(patch: Partial<Theme>): void {
  const next = { ...loadTheme(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be off; the theme still applies for this visit.
  }
  applyTheme(next);
  for (const fn of listeners) fn(next);
}

export function useTheme(): Theme {
  const [t, setT] = useState(loadTheme);
  useEffect(() => {
    listeners.add(setT);
    return () => void listeners.delete(setT);
  }, []);
  return t;
}
