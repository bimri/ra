import { back } from "./nav";

// The header of a screen you reach from another (I1, I2, I3, D2…): a back
// arrow and the screen's name, both one link back to where you came from
// (`to` when you arrived directly). `purpose` says, in a line, what this
// screen is for, so every screen answers "why am I here?".

export function BackHeader({ to, title, purpose, onBack }: { to: string; title: string; purpose?: string; onBack?: () => void }) {
  return (
    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
      <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
        <a
          href={to}
          onClick={(e) => {
            e.preventDefault();
            if (onBack) onBack();
            else back(to);
          }}
          class="hstack"
          style={{ gap: "8px", color: "var(--text)", minHeight: "44px" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          <span class="label" style={{ color: "var(--text)" }}>
            {title}
          </span>
        </a>
      </header>
      {purpose && (
        <p class="meta" style={{ margin: "6px 0 0", fontSize: "14px", flex: "none" }}>
          {purpose}
        </p>
      )}
    </div>
  );
}
