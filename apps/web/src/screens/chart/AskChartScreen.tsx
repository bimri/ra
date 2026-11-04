import { useRef, useState } from "preact/hooks";
import { api } from "../../store/device";
import { localSession } from "../../store/db";
import { BackHeader } from "../../ui/BackHeader";

// E1 · Ask your Chart. One question, answered by Spark from your own Chart
// (star, islands, markers, trips, Dial) with exact quotes you can check.
// It reads; it never changes your Chart.

type ChartAnswer = { kind: "answer" | "ask"; text: string; citations: { ref: string; quote: string }[] };

export function AskChartScreen() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ChartAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const pending = useRef<AbortController | null>(null);

  async function ask() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setProblem("");
    setAnswer(null);
    try {
      const res = await fetch(api("/chart/ask"), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-ra-account": localSession().owner },
        body: JSON.stringify({ question }),
      });
      const out = (await res.json().catch(() => null)) as (ChartAnswer & { error?: string }) | null;
      if (controller.signal.aborted) return;
      if (!res.ok || !out?.text) setProblem(out?.error ?? (navigator.onLine ? "Your Chart couldn't be read just now. Try again." : "Asking your Chart needs a connection."));
      else setAnswer(out);
    } catch {
      if (!controller.signal.aborted) setProblem(navigator.onLine ? "Your Chart couldn't be read just now. Try again." : "Asking your Chart needs a connection.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div class="ui"><div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 28px", overflowY: "auto" }}>
      <BackHeader to="/chart" title="Ask your Chart" purpose="Ask anything about your route. Ra answers only from what you’ve recorded." />
      <p class="meta" style={{ marginTop: "20px" }}>Answers only from your Chart, with quotes. Nothing changes.</p>
      <textarea class="field" aria-label="Question about your Chart" maxLength={600} disabled={busy} value={question} onInput={(e) => setQuestion(e.currentTarget.value)} rows={3} />
      <button class="btn btn-ink" style={{ marginTop: "12px" }} disabled={busy || !question.trim()} onClick={() => void ask()}>{busy ? "Reading your Chart…" : "Ask"}</button>
      {busy && <button class="btn btn-line" style={{ marginTop: "8px" }} onClick={() => { pending.current?.abort(); setBusy(false); }}>Stop</button>}
      {problem && <p class="meta" role="alert">{problem}</p>}
      {answer && (
        <div class="card" style={{ marginTop: "20px" }}>
          <div class="label">{answer.kind === "ask" ? "Not in your Chart yet" : "From your Chart"}</div>
          <p class="serif" style={{ whiteSpace: "pre-wrap" }}>{answer.text}</p>
          {answer.citations.map((c, i) => (
            <blockquote key={i} style={{ margin: "12px 0", overflowWrap: "anywhere" }}>
              <p class="meta">{c.quote}</p>
            </blockquote>
          ))}
        </div>
      )}
    </div></div>
  );
}
