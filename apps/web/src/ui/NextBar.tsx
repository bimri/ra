import { nextFor } from "@ra/core";
import { useMind } from "../store/mind";
import { Icon } from "./icons";
import { go, useWhere } from "./nav";

// The Next bar (board "Next bar · on every screen"): on screens without the
// Dock, the one step Ra would take next, and the sun to go back to Ra. It
// never offers the screen you're on, so the path always leads somewhere.

export function NextBar() {
  const { views } = useMind();
  const where = useWhere();
  const step = nextFor(views, Date.now()).find((s) => s.href !== where && s.href.split("?")[0] !== where.split("?")[0]);
  const live = views.liveRay !== null && views.rays[views.liveRay]?.endedAt === null;
  if (!step) return null;
  return (
    <nav
      class="glass nextbar"
      aria-label="Next"
      style={{ position: "fixed", left: "12px", right: "12px", bottom: "calc(16px + var(--safe-bottom, 0px))", borderRadius: "24px", padding: "12px 12px 12px 18px", display: "flex", alignItems: "center", gap: "12px", zIndex: 30, maxWidth: "616px", margin: "0 auto", fontFamily: "'Inter Tight',system-ui,sans-serif", color: "var(--text)" }}
    >
      <a href={step.href} onClick={go(step.href)} style={{ flex: 1, minWidth: 0, color: "inherit", textDecoration: "none" }}>
        <div class="label">Next</div>
        <div class="title" style={{ marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {step.title}
        </div>
      </a>
      {step.href.split("?")[0] !== "/ray" && (
        <a href="/ray" onClick={go("/ray")} class="rec" aria-label={live ? "Continue your Ray" : "Talk it through with Ra"} style={{ width: "44px", height: "44px" }} />
      )}
      <a href={step.href} onClick={go(step.href)} class="btn btn-ink btn-sm" style={{ minHeight: "44px", textDecoration: "none" }}>
        {step.cta} <Icon name="arrow" size={16} />
      </a>
    </nav>
  );
}
