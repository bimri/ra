import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

/** One definition per domain term, reused everywhere. Max ~12 words each. */
export const GLOSSARY = {
  ray: "A spoken session with Ra.",
  star: "Your mission, written in your own words.",
  ring: "Growth recorded after a Ray.",
  dial: "A dated call you make, then look at again.",
  horizon: "Where the world is going, from checked sources.",
  watch: "Ra's overnight read of your Mind.",
  marker: "How you'll know you reached an island.",
  island: "A goal on your Chart, on the way to your Star.",
  landfall: "Arrival at an island, reviewed with evidence.",
  beacon: "A short signal that helps people find you.",
  trip: "A small scouting step, made for you.",
  reading: "A weekly look at your route so far.",
} as const;

export type GlossaryTerm = keyof typeof GLOSSARY;

let nextId = 0;

/**
 * Wraps a control and shows `text` on hover, keyboard focus, or a long press.
 * On a phone a long press would otherwise open the browser's link preview
 * (showing the Worker's address); that is suppressed, and the tap after a
 * long press doesn't also follow the link.
 * The control keeps its own aria-label; the bubble is supplementary
 * (linked with aria-describedby) and never the only path to information.
 */
export function Tip({ text, children }: { text: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const idRef = useRef<string>("");
  if (!idRef.current) idRef.current = `tip-${++nextId}`;
  const id = idRef.current;
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const show = () => { if (timer.current) window.clearTimeout(timer.current); setOpen(true); };
  const hideSoon = () => { timer.current = window.setTimeout(() => setOpen(false), 120); };
  const press = useRef<number | null>(null);
  const pressed = useRef(false);
  const touchStart = () => {
    pressed.current = false;
    press.current = window.setTimeout(() => { pressed.current = true; show(); }, 450);
  };
  const touchEnd = () => {
    if (press.current) window.clearTimeout(press.current);
    if (pressed.current) timer.current = window.setTimeout(() => setOpen(false), 1600);
  };

  return (
    <span
      class="tip"
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onFocus={show}
      onBlur={hideSoon}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }}
      onTouchStart={touchStart}
      onTouchEnd={touchEnd}
      onTouchCancel={touchEnd}
      onTouchMove={touchEnd}
      onContextMenu={(e: Event) => e.preventDefault()}
      onClickCapture={(e: Event) => { if (pressed.current) { pressed.current = false; e.preventDefault(); e.stopPropagation(); } }}
    >
      <span class="tip-anchor" aria-describedby={open ? id : undefined}>{children}</span>
      {open && <span class="tip-bubble" role="tooltip" id={id}>{text}</span>}
    </span>
  );
}

/** Small info button for definitions. Tap/focus toggles; Esc dismisses. */
export function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const idRef = useRef<string>("");
  if (!idRef.current) idRef.current = `tip-${++nextId}`;
  const id = idRef.current;
  return (
    <span class="tip tip-info">
      <button
        type="button"
        class="tip-btn"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }}
      >
        i
      </button>
      {open && <span class="tip-bubble" role="tooltip" id={id}>{text}</span>}
    </span>
  );
}
