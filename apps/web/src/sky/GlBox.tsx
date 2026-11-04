import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { MOTION_SPEED, sceneColours, type SceneColours } from "../ui/theme";
import { useTheme } from "../ui/themeStore";

// A three.js scene over its flat fallback, the way the canvas hosts them
// (App UI v2, U7 "Motion, icons, 3D"): the flat drawing shows first and
// stays for weak GPUs, no WebGL or "sky off"; the scene fades in once it
// draws. It runs only while on screen, at most ~30 fps, gives its GPU
// context back after four seconds hidden, and holds one still frame for
// reduced motion. three.js and each scene load only when first needed.

export interface Scene {
  size(w: number, h: number): void;
  frame(t: number, c: SceneColours): void;
  dispose?(): void;
}
type SceneFn = (T: typeof import("three"), r: import("three").WebGLRenderer, options: object, c: SceneColours) => Scene;

export const SCENES = {
  sea: () => import("./scenes/sea"),
  ray: () => import("./scenes/ray"),
  dial: () => import("./scenes/dial"),
  island: () => import("./scenes/island"),
  rings: () => import("./scenes/rings"),
  star: () => import("./scenes/star"),
  lock: () => import("./scenes/lock"),
} satisfies Record<string, () => Promise<{ default: unknown }>>;

export type SceneName = keyof typeof SCENES;

export function GlBox({
  scene,
  options = {},
  style,
  label,
  children,
}: {
  scene: SceneName;
  /** The scene's options (the canvas's per-board O). Read every frame, so changes show at once. */
  options?: Record<string, unknown>;
  style?: JSX.CSSProperties;
  /** For a scene that means something (E4's island, E6's dial); decorative ones are hidden from readers. */
  label?: string;
  /** The flat fallback. */
  children: ComponentChildren;
}) {
  const theme = useTheme();
  const canvas = useRef<HTMLCanvasElement>(null);
  const opts = useRef<Record<string, unknown>>({ ...options });
  const colours = useRef<SceneColours>(sceneColours(theme));
  const [on, setOn] = useState(false);

  // Same object, new values: the scene reads O live.
  Object.assign(opts.current, options);
  colours.current = sceneColours(theme);
  const motion = useRef(theme.motion);
  motion.current = theme.motion;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !theme.sky) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const g = {
      dead: false,
      vis: false,
      lost: false,
      mine: false,
      raf: 0,
      t0: 0,
      last: 0,
      w: 0,
      h: 0,
      tm: 0 as number | undefined,
      r: null as import("three").WebGLRenderer | null,
      s: null as Scene | null,
      ext: null as WEBGL_lose_context | null,
      io: null as IntersectionObserver | null,
      T: null as typeof import("three") | null,
      make: null as SceneFn | null,
    };
    const show = (v: boolean) => {
      if (!g.dead) setOn(v);
    };

    function build(): boolean {
      if (!g.T || !g.make) return false;
      try {
        g.r = new g.T.WebGLRenderer({ canvas: cv!, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
      } catch {
        g.r = null;
        return false;
      }
      g.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      g.r.setClearColor(0x000000, 0);
      try {
        g.s = g.make(g.T, g.r, opts.current, colours.current);
      } catch {
        g.dead = true;
        return false;
      }
      g.ext = g.r.getContext().getExtension("WEBGL_lose_context");
      return true;
    }

    function frame(now: number) {
      g.raf = 0;
      if (!g.vis || !g.r || !g.s || g.lost || g.dead) return;
      if (!still && now - g.last < 30) {
        g.raf = requestAnimationFrame(frame);
        return;
      }
      g.last = now;
      const w = cv!.clientWidth;
      const h = cv!.clientHeight;
      if (w && h && (w !== g.w || h !== g.h)) {
        g.w = w;
        g.h = h;
        g.r.setSize(w, h, false);
        g.s.size(w, h);
      }
      if (!g.t0) g.t0 = now;
      try {
        // U6 Motion scales the sky's clock; calm is a still frame, like reduced motion.
        const speed = MOTION_SPEED[motion.current ?? 3];
        g.s.frame(still || speed === 0 ? 8 : ((now - g.t0) / 1000) * speed, colours.current);
      } catch {
        g.dead = true;
        setOn(false);
        return;
      }
      show(true);
      if (!still) g.raf = requestAnimationFrame(frame);
    }
    const kick = () => {
      if (!g.raf) g.raf = requestAnimationFrame(frame);
    };

    const lost = (e: Event) => {
      e.preventDefault();
      g.lost = true;
      if (!g.mine) show(false);
    };
    const restored = () => {
      g.lost = false;
      g.mine = false;
      if (g.vis) kick();
    };
    cv.addEventListener("webglcontextlost", lost);
    cv.addEventListener("webglcontextrestored", restored);

    function visible(v: boolean) {
      g.vis = v;
      clearTimeout(g.tm);
      if (v) {
        if (!g.r && !build()) return;
        if (g.lost) g.ext?.restoreContext();
        else kick();
      } else {
        // Hidden for a while: give the GPU context back; it's restored when seen again.
        g.tm = window.setTimeout(() => {
          if (!g.vis && g.r && !g.lost && g.ext) {
            g.mine = true;
            show(false);
            g.ext.loseContext();
          }
        }, 4000);
      }
    }

    void Promise.all([import("three"), SCENES[scene]()]).then(([T, mod]) => {
      if (g.dead) return;
      g.T = T;
      g.make = mod.default as unknown as SceneFn;
      if ("IntersectionObserver" in window) {
        g.io = new IntersectionObserver(
          (es) => {
            const e = es[es.length - 1]!;
            visible(e.isIntersecting && e.boundingClientRect.width >= 90);
          },
          { threshold: [0, 0.01] },
        );
        g.io.observe(cv);
      } else visible(true);
    });

    return () => {
      g.dead = true;
      g.io?.disconnect();
      clearTimeout(g.tm);
      if (g.raf) cancelAnimationFrame(g.raf);
      cv.removeEventListener("webglcontextlost", lost);
      cv.removeEventListener("webglcontextrestored", restored);
      try {
        g.s?.dispose?.();
        g.r?.dispose();
        g.r?.forceContextLoss();
      } catch {
        // already gone
      }
    };
  }, [scene, theme.sky]);

  return (
    <div class={`glbox${on ? " on" : ""}`} style={style} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}>
      <div class="fb">{children}</div>
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}
