import { render } from "preact";
import { App } from "./app";
import { applyTheme } from "./ui/theme";
import { loadTheme } from "./ui/themeStore";
import "./ui/v2.css";
import "./ui/app.css";

applyTheme(loadTheme());
/**
 * Fit the boards (drawn at 390px wide) to this screen: a small phone gets them
 * slightly smaller (never under 88%, so labels stay readable), a tablet larger
 * (up to 140%, bounded by its height) with room for a wider column.
 */
function fit(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const z = w < 390 ? Math.max(0.88, w / 390) : Math.max(1, Math.min(1.4, w / 560, h / 700));
  document.documentElement.style.setProperty("--z", z.toFixed(3));
}
fit();
window.addEventListener("resize", fit);

render(<App />, document.getElementById("app")!);

// An app, not a page: a long press on a link never opens the browser's link menu
// (which shows the Worker's address). Text fields keep their own menu for paste.
document.addEventListener("contextmenu", (e) => {
  if ((e.target as Element | null)?.closest?.("a, button, .tip")) e.preventDefault();
});

// The app opens offline (J2). Not under the Vite dev server, where files change constantly.
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // No service worker (an old WebView): Ra still works online.
    });
  });
}
