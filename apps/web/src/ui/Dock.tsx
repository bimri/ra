import { Icon, type IconName } from "./icons";
import { Tip, GLOSSARY } from "./Tooltip";
import { go, navigate } from "./nav";

// The glass dock (U3, U5, E1, H3): four places and the sun in the middle.
// Tap the sun to start a Ray; hold it to keep a thought (C2 "Holding the sun").

const HOLD_MS = 350;
let held: number | null = null;
let wasHeld = false;

function holdSun() {
  wasHeld = false;
  held = window.setTimeout(() => {
    wasHeld = true;
    navigate("/speak");
  }, HOLD_MS);
}

function letGo() {
  if (held !== null) clearTimeout(held);
  held = null;
}

const TABS: { path: string; label: string; icon: IconName; tip: string }[] = [
  { path: "/", label: "Today", icon: "today", tip: "Today's heading, trip and rings." },
  { path: "/chart", label: "Chart", icon: "chart", tip: "Your Star, islands, Horizon and Dial." },
  { path: "/rings", label: "Rings", icon: "rings", tip: GLOSSARY.ring },
  { path: "/crews", label: "Crews", icon: "crews", tip: "People steering by a star like yours." },
];

export function Dock({ here }: { here: string }) {
  const tab = (t: (typeof TABS)[number]) => (
    <Tip key={t.path} text={t.tip}>
      <a class={`tab${here === t.path ? " on" : ""}`} href={t.path} onClick={go(t.path)} aria-current={here === t.path ? "page" : undefined}>
        <Icon name={t.icon} />
        {t.label}
      </a>
    </Tip>
  );
  return (
    <nav class="tabbar" aria-label="Ra">
      {tab(TABS[0]!)}
      {tab(TABS[1]!)}
      <Tip text="Tap to start a Ray. Hold to keep a thought.">
      <a
        href="/ray"
        onClick={(e) => (wasHeld ? e.preventDefault() : go("/ray")(e))}
        onPointerDown={holdSun}
        onPointerUp={letGo}
        onPointerLeave={letGo}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Start a Ray. Hold to keep a thought"
        class="rec"
        style={{ width: "56px", height: "56px", textDecoration: "none" }}
      />
      </Tip>
      {tab(TABS[2]!)}
      {tab(TABS[3]!)}
    </nav>
  );
}
