import { AskChartScreen } from "./screens/chart/AskChartScreen";
import { TripsScreen } from "./screens/trips/TripsScreen";
import { useEffect, useState } from "preact/hooks";
import { vaultReady, vaultAccount } from "./auth/vault";
import { LocalLockScreen } from "./screens/lock/LocalLockScreen";
import { OnlineAccountScreen } from "./screens/mind/OnlineAccountScreen";
import { ExportScreen } from "./screens/mind/ExportScreen";
import type { ComponentType } from "preact";
import { AppearanceScreen } from "./screens/appearance/AppearanceScreen";
import { BringBackScreen } from "./screens/bringback/BringBackScreen";
import { ChartScreen } from "./screens/chart/ChartScreen";
import { DialScreen } from "./screens/chart/DialScreen";
import { DialReviewScreen } from "./screens/chart/DialReviewScreen";
import { HorizonScreen } from "./screens/chart/HorizonScreen";
import { IslandScreen } from "./screens/chart/IslandScreen";
import { MarkersScreen } from "./screens/chart/MarkersScreen";
import { RouteScreen } from "./screens/chart/RouteScreen";
import { SignalScreen } from "./screens/chart/SignalScreen";
import { VoyageScreen } from "./screens/chart/VoyageScreen";
import { FirstLight, prefs } from "./screens/onboarding/FirstLight";
import { RayScreen } from "./screens/ray/RayScreen";
import { BeaconScreen } from "./screens/crew/BeaconScreen";
import { CrewScreen } from "./screens/crew/CrewScreen";
import { IntroScreen } from "./screens/crew/IntroScreen";
import { LandfallScreen } from "./screens/landfall/LandfallScreen";
import { PostcardScreen } from "./screens/landfall/PostcardScreen";
import { ShareScreen } from "./screens/landfall/ShareScreen";
import { SpeakScreen } from "./screens/speak/SpeakScreen";
import { PlaybackScreen } from "./screens/rings/PlaybackScreen";
import { ThenScreen } from "./screens/rings/ThenScreen";
import { RingsScreen } from "./screens/rings/RingsScreen";
import { TodayScreen } from "./screens/today/TodayScreen";
import { useWhere } from "./ui/nav";
import { hasAccount, useLocked } from "./auth/lock";
import { LockedScreen } from "./screens/lock/LockedScreen";
import { NextBar } from "./ui/NextBar";
import { EarScreen } from "./screens/mind/EarScreen";
import { MemoryScreen } from "./screens/mind/MemoryScreen";
import { WatchScreen } from "./screens/mind/WatchScreen";
import { YourMindScreen } from "./screens/mind/YourMindScreen";

// Screens are routes named after the canvas boards (U3 Today, U4 Ray, E1
// Chart, U5 Rings…). Until someone has been through first light (A1–A4),
// that's where Ra starts. A route with no screen yet falls back to Today.
const ROUTES: Record<string, ComponentType> = {
  "/": TodayScreen,
  "/welcome": FirstLight,
  "/ray": RayScreen,
  "/crews": CrewScreen,
  "/beacon": BeaconScreen,
  "/intro": IntroScreen,
  "/landfall": LandfallScreen,
  "/share": ShareScreen,
  "/speak": SpeakScreen,
  "/chart": ChartScreen,
  "/chart/horizon": HorizonScreen,
  "/chart/signal": SignalScreen,
  "/chart/ask": AskChartScreen,
  "/chart/island": IslandScreen,
  "/chart/markers": MarkersScreen,
  "/chart/route": RouteScreen,
  "/chart/dial": DialScreen,
  "/voyage": VoyageScreen,
  "/chart/dial/review": DialReviewScreen,
  "/rings": RingsScreen,
  "/trips": TripsScreen,
  "/playback": PlaybackScreen,
  "/then": ThenScreen,
  "/appearance": AppearanceScreen,
  "/bring-back": BringBackScreen,
  "/mind": YourMindScreen,
  "/mind/sign-in": OnlineAccountScreen,
  "/mind/export": ExportScreen,
  "/memories": MemoryScreen,
  "/watch": WatchScreen,
  "/ear": EarScreen,
};

export function App() {
  const [localReady, setLocalReady] = useState(vaultReady());
  useEffect(() => {
    const opened = () => setLocalReady(true);
    const closed = () => setLocalReady(false);
    window.addEventListener("ra-local-ready", opened);
    window.addEventListener("ra-vault-closed", closed);
    return () => { window.removeEventListener("ra-local-ready", opened); window.removeEventListener("ra-vault-closed", closed); };
  }, []);
  const where = useWhere();
  const path = where.split("?")[0]!;
  const locked = useLocked();
  // G5: a postcard is for whoever has the link, Ra or not: no lock, no first light.
  if (path.startsWith("/l/")) return <PostcardScreen key={path} />;
  if (!localReady && (hasAccount() || prefs.get("firstLight", false) || (path !== "/" && path !== "/welcome"))) return <LocalLockScreen />;
  // A live Ray isn't interrupted by the lock; everything else is.
  if (locked && path !== "/ray") return <LockedScreen />;
  if (localReady && localStorage.getItem(`ra.erase.${vaultAccount()}`)) return <YourMindScreen />;
  const Screen = path === "/" && !prefs.get("firstLight", false) ? FirstLight : (ROUTES[path] ?? TodayScreen);
  // Today, Chart, Rings and Crews have the Dock; the Ray and first light are their own path. Everywhere else, the Next bar.
  const docked = Screen === FirstLight || Screen === RayScreen || ["/", "/chart", "/rings", "/crews", "/welcome", "/speak"].includes(path) || !ROUTES[path];
  return (
    <>
      <Screen key={where} />
      {!docked && <NextBar />}
    </>
  );
}
