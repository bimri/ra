import { useEffect, useState } from "preact/hooks";
import { PostcardCard } from "./ShareScreen";

// G5 · a landfall postcard, as someone with the link sees it. It's public by
// its owner's choice and carries only what they switched on; when they turn
// the link off, it's gone. Nothing here reaches anyone's mind.

interface Card {
  name: string | null;
  island: string;
  at: number;
  note: string;
  said: string;
  markers?: { text: string; evidence: string }[];
  witnessedBy?: string[];
  star?: string | null;
  rings?: number;
  voice: boolean;
}

export function PostcardScreen() {
  const token = location.pathname.slice("/l/".length).replace(/[^0-9a-f]/g, "");
  const [card, setCard] = useState<Card | null | "gone">(null);
  useEffect(() => {
    fetch(`/l/${token}.json`)
      .then((r): Promise<Card | "gone"> | "gone" => (r.ok ? (r.json() as Promise<Card>) : "gone"))
      .then(setCard, () => setCard("gone"));
  }, [token]);

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
          <span style={{ fontWeight: 600, fontSize: "20px", letterSpacing: "-.04em" }}>Ra</span>
          <span class="label">A landfall postcard</span>
        </header>
        {card === null ? (
          <p class="meta" style={{ margin: "18px 0 0" }}>
            …
          </p>
        ) : card === "gone" ? (
          <>
            <div class="h1" style={{ marginTop: "24px", fontSize: "34px" }}>
              This postcard was taken down.
            </div>
            <p class="meta" style={{ margin: "10px 0 0" }}>
              Whoever sent it turned the link off.
            </p>
          </>
        ) : (
          <>
            <PostcardCard island={card.island} from={card.name} at={card.at} note={card.note} />
            {card.said && (
              <p class="serif" style={{ margin: "22px 0 0", fontSize: "22px", fontStyle: "italic", lineHeight: 1.2 }}>
                “{card.said}”
              </p>
            )}
            {card.voice && <audio controls src={`/l/${token}.wav`} style={{ width: "100%", marginTop: "14px" }} />}
            {card.markers && (
              <div style={{ marginTop: "14px" }}>
                {card.markers.map((m) => (
                  <div key={m.text} class="row" style={{ alignItems: "flex-start", padding: "10px 0" }}>
                    <div class="grow">
                      <div style={{ fontSize: "15px", lineHeight: 1.3 }}>{m.text}</div>
                      {m.evidence && (
                        <div class="label" style={{ marginTop: "4px" }}>
                          {m.evidence}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {card.witnessedBy && card.witnessedBy.length > 0 && <p class="label">Witness · {card.witnessedBy.join(", ")}</p>}
              </div>
            )}
            {card.star && (
              <p class="meta" style={{ margin: "14px 0 0" }}>
                Steering by: {card.star}
              </p>
            )}
            {card.rings !== undefined && (
              <p class="meta" style={{ margin: "6px 0 0" }}>
                {card.rings} rings so far.
              </p>
            )}
            <div style={{ flex: 1, minHeight: "18px" }} />
            <p class="meta" style={{ paddingBottom: "28px" }}>
              Only what {card.name ?? "they"} chose travels here. Their mind never leaves.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
