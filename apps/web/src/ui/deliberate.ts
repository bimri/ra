/**
 * A press that leaves the screen must be one the person made on that control.
 * A screen that appears under a finger or a stray key (an Android volume key, a
 * key event the WebView turns into a click on whatever holds focus) must not
 * follow a link on its own. A click counts only after a pointer went down on
 * the control, or Enter/Space was pressed on it, and not in the first moments
 * after the screen appeared.
 */
export const SETTLE_MS = 700;

export function deliberate(shownAt: number, settleMs = SETTLE_MS) {
  let armed = false;
  return {
    down(): void {
      armed = true;
    },
    key(key: string): void {
      if (key === "Enter" || key === " ") armed = true;
    },
    /** True once per deliberate press; resets so a second synthetic click can't ride on it. */
    click(now: number): boolean {
      const ok = armed && now - shownAt >= settleMs;
      armed = false;
      return ok;
    },
  };
}
