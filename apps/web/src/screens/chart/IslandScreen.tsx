import { MarkerProgress } from "./MarkerProgress";
import {currentIsland} from "@ra/core";
import { useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { go } from "../../ui/nav";
import { GlBox } from "../../sky/GlBox";
import { ISLAND_SVG } from "../../ui/art/island";

// E4 · Next island: why it's on your route (the sky, where you stand, your
// own words) and the markers you named for it (E5), in your words.

export function IslandScreen() {
  const { views } = useMind();
  const requested=new URLSearchParams(location.search).get("island");
  const selected=requested??currentIsland(views);
  const name = selected&&(views.markers[selected]||views.islands[selected])?selected:null;
  const island = name ? views.islands[name] : undefined;
  const markers = name ? views.markers[name] : undefined;
  const landfall = name ? views.landfalls.find((l) => l.island === name) : undefined;

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div class="spread">
          <BackHeader to="/chart" title="Next island" purpose="What you’re working toward now. Reach every marker, then make landfall." />
          {name===currentIsland(views)&&name && (
            <a href={`/voyage?island=${encodeURIComponent(name)}`} onClick={go(`/voyage?island=${encodeURIComponent(name)}`)} class="btn btn-line btn-sm">
              Voyage
            </a>
          )}
        </div>
        {!name ? (
          <>
            <div class="h1" style={{ marginTop: "18px", fontSize: "32px" }}>
              Not charted yet.
            </div>
          </>
        ) : (
          <>
            <GlBox
              scene="island"
              options={{}}
              label={`${name} as an island of contour lines: village lights along its shore, one of them flickering, and mist drifting at its foot`}
              style={{ height: "196px", margin: "8px -20px 0", flex: "none" }}
            >
              <div
                style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                // The canvas's own drawing, static and trusted.
                dangerouslySetInnerHTML={{ __html: ISLAND_SVG }}
              />
            </GlBox>
            <div class="big" style={{ fontSize: "48px", marginTop: "4px", lineHeight: 0.9 }}>
              {name}
            </div>
            {island && (
              <>
                <div class="label" style={{ marginTop: "16px" }}>
                  Why it’s on your route
                </div>
                <div>
                  {(
                    [
                      ["Inevitable", island.inevitable],
                      ["Adjacent", island.adjacent],
                      ["Yours", island.yours],
                    ] as const
                  ).map(([label, text]) => (
                    <div key={label} class="row" style={{ alignItems: "flex-start", padding: "13px 0" }}>
                      <span class="label" style={{ width: "86px", flex: "none", paddingTop: "3px" }}>
                        {label}
                      </span>
                      <div class="grow" style={{ fontSize: "15px", lineHeight: 1.4 }}>
                        {text}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {island?.proposal&&<details class="card" style={{marginTop:"14px"}}><summary>First step and sources</summary><p>{island.proposal.firstStep}</p><p class="meta">Limits: {island.proposal.circumstances}</p>{island.proposal.evidence.map((evidence,index)=><blockquote class="serif" key={index}>{evidence.quote}</blockquote>)}{island.proposal.horizon.map(source=><div key={source.id}><p>{source.text}</p><span class="label">Read {new Date(source.at).toLocaleDateString("en-GB")}</span>{source.sources.map(url=><a class="row" href={url} key={url} target="_blank" rel="noopener noreferrer" style={{overflowWrap:"anywhere"}}>{url}</a>)}</div>)}</details>}
            {!markers&&<a class="btn btn-line" style={{marginTop:"18px"}} href={"/chart/markers?island="+encodeURIComponent(name)} onClick={go("/chart/markers?island="+encodeURIComponent(name))}>Name your markers</a>}
            {markers && (
              <>
                <div class="spread" style={{ marginTop: "14px" }}>
                  <a class="label" href={"/chart/markers?island="+encodeURIComponent(name)} onClick={go("/chart/markers?island="+encodeURIComponent(name))}>Markers you named · edit</a>
                  <span class="mono" style={{ fontSize: "12px" }}>
                    {landfall ? markers.markers.length : markers.markers.filter((text) => views.markerAchievements.some((a) => a.island === name && a.marker === text)).length} / {markers.markers.length}
                  </span>
                </div>
                <div style={{ marginTop: "4px" }}>
                  <MarkerProgress island={name} />
                </div>
                {/* G4: you say when you've arrived. */}
                <a href={`/landfall?island=${encodeURIComponent(name!)}`} onClick={go(`/landfall?island=${encodeURIComponent(name!)}`)} class="btn btn-line" style={{ width: "100%", marginTop: "18px" }}>
                  {landfall ? "Your landfall" : "I've arrived"}
                </a>
                {markers.changedAt !== null && (
                  <p class="meta" style={{ margin: "10px 0 0" }}>
                    First named as: {markers.first.join(" · ")}
                  </p>
                )}
              </>
            )}
          </>
        )}
        <div style={{ flex: 1, minHeight: "28px" }} />
      </div>
    </div>
  );
}
