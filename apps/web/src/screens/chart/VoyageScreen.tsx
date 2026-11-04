import { currentIsland } from "@ra/core";
import { useState } from "preact/hooks";
import { api } from "../../store/device";
import { mind, useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { Icon } from "../../ui/icons";

// K1 · Voyage: a route to one island, with the markers you named. It ends
// when you arrive. No subscription: it's free, priced where you live, or
// covered by a mission funder, and Ra always tells you who. Funders never
// see your mind or touch your route; they learn you arrived only if you
// share a signed claim.

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "include" }).catch(() => null);
  if (!res) throw new Error("Couldn't connect. Your request can be retried.");
  if (!res.ok) throw new Error(res.status === 409 || res.status === 503 ? await res.text() : "That request could not be completed.");
  return (await res.json()) as T;
}

export function VoyageScreen() {
  const { views } = useMind();
  const island = new URLSearchParams(location.search).get("island") ?? currentIsland(views);
  const currentMarkers = island ? (views.markers[island]?.markers ?? []) : [];
  const voyage = views.voyages.filter((v) => v.island === island).at(-1);
  const markers = voyage?.markerTexts ?? currentMarkers;
  const landfall = views.landfalls.find((l) => l.island === island && (!voyage || l.at >= voyage.at));
  const [pledgeAmount, setPledgeAmount] = useState("");
  const [pledgeCurrency, setPledgeCurrency] = useState("");
  const [pledged, setPledged] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function act(run: () => Promise<void>) {
    setBusy(true); setProblem(null);
    try { await run(); } catch (error) { setProblem(error instanceof Error ? error.message : "That request could not be completed."); }
    finally { setBusy(false); }
  }

  async function start() {
    await act(async () => { await post("/voyage", {}); await mind().sync(); });
  }

  async function shareMarker(markerIndex:number) {
    await act(async () => { await post("/voyage/claim",{ voyageId:voyage!.voyageId,kind:"marker",markerIndex }); await mind().sync(); });
  }

  async function shareArrival() {
    await act(async () => { await post("/voyage/claim", { voyageId: voyage!.voyageId, kind: "landfall" }); await mind().sync(); });
  }

  async function payForward() {
    await act(async () => {
    const amountCents = Math.round(Number(pledgeAmount) * 100);
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(pledgeAmount) || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !/^[A-Z]{3}$/.test(pledgeCurrency)) {
      throw new Error("Choose an amount with up to two decimal places and a three-letter currency.");
    }
    const result = await post("/voyage/forward", { amountCents, currency: pledgeCurrency, operationId });
    if (result) setPledged(true);
    });
  }

  const shared = voyage?.claims.some((c) => c.kind === "landfall") ?? false;
  const achievement = (index:number) => views.markerAchievements.find((a) => a.island === island && a.markerId === voyage?.markerIds?.[index] && (!voyage || a.at >= voyage.at));
  const reached = landfall ? markers.length : markers.filter((_,i) => achievement(i)).length;

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <BackHeader to={island ? `/chart/island?island=${encodeURIComponent(island)}` : "/chart"} title="Voyage" purpose="Backing for this island, paid only when you reach what you said you would." />
        <div class="big" style={{ fontSize: "56px", marginTop: "18px", lineHeight: 0.9 }}>
          {island ?? "No island yet"}
        </div>

        {voyage ? (
          <div class="card" style={{ marginTop: "18px" }}>
            <div class="label">Who funds it</div>
            <div class="title" style={{ fontSize: "16px", marginTop: "8px" }}>
              {voyage.funder
                ? `Free for you. Funded by ${voyage.funder.name.toLowerCase().startsWith("a ") ? voyage.funder.name.toLowerCase() : voyage.funder.name}: ${voyage.funder.mission.charAt(0).toLowerCase()}${voyage.funder.mission.slice(1)}`
                : voyage.price
                  ? `${(voyage.price.amountCents / 100).toFixed(2)} ${voyage.price.currency}, priced for where you live.`
                  : "Voyage terms are unavailable."}
            </div>
            <div class="hair" style={{ marginTop: "12px", paddingTop: "10px" }}>
              <span class="meta">Funders never see your mind or touch your route.</span>
            </div>
          </div>
        ) : (
          island && (
            <div class="card" style={{ marginTop: "18px" }}>
              <div class="label">Who funds it</div>
              <div class="title" style={{ fontSize: "16px", marginTop: "8px" }}>
                Ra looks for a mission funder who backs journeys like yours. If there isn't one, it's priced for where you live.
              </div>
              <div class="hair" style={{ marginTop: "12px", paddingTop: "10px" }}>
                <span class="meta">Funders never see your mind or touch your route.</span>
              </div>
            </div>
          )
        )}

        {markers.length > 0 && (
          <>
            <div class="spread" style={{ marginTop: "20px" }}>
              <span class="label">Markers</span>
              <span class="mono" style={{ fontSize: "12px" }}>
                {reached} / {markers.length}
              </span>
            </div>
            <div>
              {markers.map((m,i) => (
                <div key={m} class="row" style={{ padding: "10px 0" }}>
                  <span style={{ flex: "none", width: "26px", height: "26px", borderRadius: "50%", ...(landfall || achievement(i) ? { background: "var(--ink)" } : { boxShadow: "inset 0 0 0 1.5px var(--line)" }) }} />
                  <div class="grow" style={{ fontSize: "15px" }}>
                    {m}
                    {voyage?.funder && achievement(i) && <div style={{ marginTop:"8px" }}>{voyage.claims.some((c) => c.kind === "marker" && c.markerIndex === i) ? <span class="meta">Marker shared with your funder.</span> : <><p class="meta">Signed note only. Words and evidence stay private.</p><button class="btn btn-line btn-sm" disabled={busy} onClick={() => void shareMarker(i)}>Share this marker</button></>}</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {voyage?.funder && landfall && (
          <div class="card" style={{ marginTop: "16px" }}>
            <div class="title" style={{ fontSize: "15px" }}>
              {shared ? "Your funder knows you arrived." : "Tell your funder you arrived?"}
            </div>
            <p class="meta" style={{ margin: "6px 0 0" }}>
              {shared ? "They got a signed note of your landfall: nothing else." : "They'd get a signed note that you made landfall, and when. No evidence, no words, nothing from your mind."}
            </p>
            {!shared && (
              <button type="button" class="btn btn-ink btn-sm" style={{ marginTop: "12px" }} disabled={busy} onClick={() => void shareArrival()}>
                Share my arrival
              </button>
            )}
          </div>
        )}
        {landfall && <div class="card" style={{ marginTop: "16px" }}>
          <div class="title">Pay a voyage forward</div>
          <p class="meta">A voluntary pledge for someone else's voyage. No money is collected here.</p>
          {pledged ? <p role="status">Your pledge is recorded, pending payment setup.</p> : <>
            <input class="field" type="number" min="0.01" step="0.01" aria-label="Pledge amount" value={pledgeAmount} onInput={(e) => setPledgeAmount(e.currentTarget.value)} />
            <input class="field" maxlength={3} aria-label="Pledge currency" placeholder="Currency, e.g. KES" value={pledgeCurrency} onInput={(e) => setPledgeCurrency(e.currentTarget.value.toUpperCase())} />
            <button class="btn btn-line" disabled={busy || !pledgeAmount || !pledgeCurrency} onClick={() => void payForward()}>Pledge {pledgeAmount} {pledgeCurrency}</button>
          </>}
        </div>}
        {problem && (
          <p class="meta" role="alert" style={{ color: "var(--accent)", margin: "10px 0 0" }}>
            {problem}
          </p>
        )}

        <div style={{ flex: 1, minHeight: "18px" }} />
        {voyage ? (
          <p class="label" style={{ paddingBottom: "30px", lineHeight: 1.6 }}>
            Started {new Date(voyage.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {landfall ? "closed at landfall" : "closes at landfall"} · no subscription
          </p>
        ) : (
          <div style={{ paddingBottom: "30px" }}>
            <button type="button" class="btn btn-ink" style={{ width: "100%" }} disabled={busy || !island || !views.star.current} onClick={() => void start()}>
              <Icon name="island" size={18} /> Start this voyage
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
