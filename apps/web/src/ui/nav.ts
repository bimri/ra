import { useEffect, useState } from "preact/hooks";

// A small router: screens are routes named after the canvas boards (U3
// Today at "/", U4 Ray at "/ray", E1 Chart, U5 Rings, H3 Crews…). Context
// travels in the query (/chart/markers?island=…), and a change to the query
// alone is a new screen too. Each in-app step is counted in history.state,
// so Back returns to where you came from instead of a guessed parent.

const listeners = new Set<(where: string) => void>();
const here = () => location.pathname + location.search;
const depth = (): number => (history.state && typeof history.state.ra === "number" ? history.state.ra : 0);

function tell() {
  for (const fn of listeners) fn(here());
}

/** Go to an in-app path (it may carry a query, like /chart/signal?id=…). */
export function navigate(path: string, { replace = false } = {}): void {
  if (path === here()) return;
  if (replace) history.replaceState({ ra: depth() }, "", path);
  else history.pushState({ ra: depth() + 1 }, "", path);
  tell();
}

/** Back to the screen you came from; `fallback` when you arrived here directly (a link, a reload, a push). */
export function back(fallback: string): void {
  if (depth() > 0) history.back();
  else navigate(fallback, { replace: true });
}

window.addEventListener("popstate", tell);

/** The pathname, re-rendering on any change of path or query. */
export function useRoute(): string {
  return useWhere().split("?")[0]!;
}

/** Path and query together: a screen's identity. */
export function useWhere(): string {
  const [where, setWhere] = useState(here());
  useEffect(() => {
    listeners.add(setWhere);
    return () => void listeners.delete(setWhere);
  }, []);
  return where;
}

/** An in-app link: same look as an anchor, no page load. */
export function go(path: string) {
  return (e: Event) => {
    e.preventDefault();
    navigate(path);
  };
}
