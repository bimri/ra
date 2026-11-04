import type { MemoryView } from "@ra/core";
import { useState } from "preact/hooks";
import { mind, useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { accentTail, whereSaid } from "./words";

// I2 · What Ra remembers. Every memory shows where it came from, in your own
// words, and you can edit it or have it forgotten. What you say about
// yourself outranks what Ra inferred; forgotten means gone.

const byConfidence = (a: MemoryView, b: MemoryView) => b.confidence - a.confidence;

export function MemoryScreen() {
  const { views } = useMind();
  const memories = Object.values(views.memories).filter((m) => m.claim).sort(byConfidence);
  const [chosen, setChosen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const memory = memories.find((m) => m.memoryId === chosen) ?? memories[0];

  function pick(id: string) {
    setChosen(id);
    setEditing(null);
    setForgetting(false);
  }

  async function save() {
    if (!memory || editing === null) return;
    const claim = editing.trim();
    if (claim && claim !== memory.claim) await mind().write("memory.corrected", { memoryId: memory.memoryId, claim });
    setEditing(null);
  }

  async function forget() {
    if (!memory) return;
    if (!forgetting) return setForgetting(true);
    await mind().write("memory.corrected", { memoryId: memory.memoryId, forget: true });
    setForgetting(false);
    setChosen(null);
  }

  const said = memory ? mind().said(memory.sources) : [];
  const words = memory
    ? memory.sources.map((id, i) => {
        const line = said.find((s) => s.utteranceId === id);
        return { id, text: (memory.quotes[i] ?? line?.text ?? "").replace(/^["“”]+|["“”]+$/g, ""), where: line ? whereSaid(views, line) : null };
      })
    : [];
  const [lead, tail] = memory ? accentTail(memory.claim) : ["", ""];

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <BackHeader to="/mind" title="What Ra remembers" purpose="What Ra thinks it knows about you, with your own words. Correct anything." />
        {!memory ? (
          <>
            <div class="h1" style={{ marginTop: "14px", fontSize: "32px" }}>
              Nothing yet.
            </div>
            <p class="meta" style={{ margin: "12px 0 0", maxWidth: "300px" }}>
              Memories appear after the Watch runs.
            </p>
          </>
        ) : (
          <>
            {editing === null ? (
              <div class="h1" style={{ marginTop: "14px", fontSize: "32px" }}>
                {lead}
                {tail && <span class="accent">{tail}</span>}
              </div>
            ) : (
              <textarea
                class="h1"
                aria-label="What Ra should remember"
                value={editing}
                onInput={(e) => setEditing((e.target as HTMLTextAreaElement).value)}
                rows={3}
                style={{ marginTop: "14px", fontSize: "32px", font: "inherit", fontWeight: 500, background: "transparent", color: "var(--text)", border: "none", borderBottom: "1px solid var(--line)", resize: "none", outline: "none", padding: 0 }}
              />
            )}
            <div class="hstack" style={{ gap: "8px", marginTop: "16px" }}>
              {editing === null ? (
                <button type="button" class="btn btn-line btn-sm" onClick={() => setEditing(memory.claim)}>
                  Edit
                </button>
              ) : (
                <button type="button" class="btn btn-ink btn-sm" onClick={save}>
                  Keep this
                </button>
              )}
              <button type="button" class="btn btn-line btn-sm" style={{ color: "#E5322D" }} onClick={forget}>
                {forgetting ? "Tap again to forget" : "Forget this"}
              </button>
              {memory.corrected && <span class="meta">in your words</span>}
            </div>

            <div class="label" style={{ marginTop: "22px" }}>
              Where this comes from · your own words
            </div>
            <div>
              {words.map((w) => (
                <div key={w.id} class="row">
                  <div class="grow" style={{ padding: "10px 0" }}>
                    <div style={{ fontSize: "16px", letterSpacing: "-.02em" }}>“{w.text}”</div>
                    {w.where && (
                      <div class="label" style={{ marginTop: "3px" }}>
                        {w.where}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {memories.length > 1 && (
              <>
                <div class="label" style={{ marginTop: "20px" }}>
                  Other memories
                </div>
                <div>
                  {memories
                    .filter((m) => m.memoryId !== memory.memoryId)
                    .map((m) => (
                      <button
                        type="button"
                        key={m.memoryId}
                        class="row"
                        onClick={() => pick(m.memoryId)}
                        style={{ minHeight: "46px", fontSize: "15px", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid var(--line)", color: "var(--text)", font: "inherit", cursor: "pointer", padding: "10px 0" }}
                      >
                        {m.claim}
                      </button>
                    ))}
                </div>
              </>
            )}
          </>
        )}
        <div style={{ flex: 1 }} />
        <p class="meta" style={{ paddingBottom: "28px", paddingTop: "16px" }}>
          Forgotten means gone. It never comes back.
        </p>
      </div>
    </div>
  );
}
