import { waitingTrips, type TripView, type Views } from "@ra/core";
import { useState } from "preact/hooks";
import { mind, useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { navigate } from "../../ui/nav";

// B8/B9 outside a Ray: trips that were ready only after the Ray ended
// ("I'll have your trips by tonight") are chosen here. Choosing writes the
// same trip.chosen event the Ray would have, so Today and Ray 2 follow it.

/** The newest Ray's offered trips, while none of them is picked yet. */
export function offeredTrips(trips: Views["trips"]): TripView[] {
  return waitingTrips({ trips } as Views);
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function TripsScreen() {
  const { views } = useMind();
  const trips = offeredTrips(views.trips);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const trip = trips.find((t) => t.tripId === open);

  async function take(t: TripView) {
    setBusy(true);
    setProblem("");
    try {
      await mind().write("trip.chosen", { tripId: t.tripId });
      navigate("/");
    } catch {
      setProblem("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (trip) {
    return (
      <div class="ui"><div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <BackHeader to="/trips" title={`Trip ${trips.indexOf(trip) + 1} of ${trips.length}`} onBack={() => setOpen(null)} />
        <h1 class="h1" style={{ marginTop: "20px" }}>{trip.title ?? trip.action}</h1>
        <div class="stack" style={{ gap: "16px", marginTop: "22px" }}>
          <div><div class="label">Tests</div><p class="meta" style={{ margin: "6px 0 0" }}>{trip.purpose}</p></div>
          <div><div class="label">Do</div><p style={{ margin: "6px 0 0" }}>{trip.action}</p></div>
          <div><div class="label">Cost</div><p class="meta" style={{ margin: "6px 0 0" }}>{trip.cost}</p></div>
          <div><div class="label">Bring back</div><p class="meta" style={{ margin: "6px 0 0" }}>{trip.evidence}</p></div>
          <div><div class="label">Why now</div><p class="meta" style={{ margin: "6px 0 0" }}>{trip.whyNow}</p></div>
          {trip.sources.length > 0 && (
            <div><div class="label">Sources</div>
              <p class="meta" style={{ margin: "6px 0 0" }}>
                {trip.sources.map((s, i) => <span key={s}>{i ? " · " : ""}<a href={s} target="_blank" rel="noopener noreferrer">{host(s)}</a></span>)}
              </p>
            </div>
          )}
        </div>
        {problem && <p class="meta" role="alert">{problem}</p>}
        <div class="hstack" style={{ gap: "8px", marginTop: "24px" }}>
          <button type="button" class="btn btn-ink" disabled={busy} onClick={() => void take(trip)}>{busy ? "Saving…" : "Take this one"}</button>
          <button type="button" class="btn btn-line" disabled={busy} onClick={() => setOpen(null)}>Back to all three</button>
        </div>
      </div></div>
    );
  }

  return (
    <div class="ui"><div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <BackHeader to="/" title="Scouting trips" purpose="Small experiments made from what you said. Pick the one that pulls you." />
      {trips.length === 0 ? (
        <p class="meta" style={{ marginTop: "24px" }}>No trips waiting.</p>
      ) : (
        <>
          <h1 class="h1" style={{ marginTop: "20px" }}>Pick a trip.</h1>
          <div class="stack" style={{ gap: "12px", marginTop: "18px" }}>
            {trips.map((t) => (
              <button type="button" key={t.tripId} class="card" style={{ textAlign: "left", color: "inherit" }} onClick={() => setOpen(t.tripId)}>
                <div class="title">{t.title ?? t.action}</div>
                <div class="meta" style={{ marginTop: "6px" }}>{t.purpose}</div>
                <div class="label" style={{ marginTop: "8px" }}>{t.cost}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div></div>
  );
}
