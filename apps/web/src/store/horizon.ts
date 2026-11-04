import { useEffect, useState } from "preact/hooks";
import type { SignalCard,HorizonRefreshStatus } from "@ra/core";
import { api } from "./device";
import { vaultAccount, vaultEpoch } from "../auth/vault";

// Your field's horizon (E1–E3), read through the Worker from its HorizonDO.
// One read per visit; the Chart and its screens share it.

export interface Horizon {
  field: { id: string; name: string } | null;
  signals: (SignalCard & { at?: number })[];
  refresh?:HorizonRefreshStatus|null;
}

let cached: Horizon | null = null;
let inFlight: Promise<Horizon | null> | null = null;
if(typeof window!=="undefined")window.addEventListener("ra-vault-closed",()=>{cached=null;inFlight=null});

function load(): Promise<Horizon | null> {
  const owner=vaultAccount();const epoch=vaultEpoch();
  if(!owner)return Promise.resolve(null);
  if(inFlight)return inFlight;
  const task = fetch(api("/horizon"),{cache:"no-store",signal:AbortSignal.timeout(15_000),headers:{"x-ra-account":owner}})
    .then((r) => (r.ok ? (r.json() as Promise<Horizon>) : null))
    .then((h) => {if(vaultAccount()!==owner||vaultEpoch()!==epoch)return null;return cached=h}, () => null)
    .finally(() => {
      if(inFlight===task)inFlight = null;
    });
  return inFlight=task;
}
/** Explicit refresh only reads the shared Horizon; it never uploads captures or changes a call. */
export function refreshHorizon():Promise<Horizon|null>{return load()}

export function useHorizon(): Horizon | null {
  const [h, setH] = useState<Horizon | null>(cached);
  useEffect(() => {
    let active=true,polls=0;let timer:ReturnType<typeof setTimeout>|undefined;
    const closed=()=>{active=false;if(timer)clearTimeout(timer);setH(null)};
    const check=()=>{void load().then(fresh=>{if(!active)return;if(fresh)setH(fresh);if(fresh&&["queued","running"].includes(fresh.refresh?.state??"")&&polls++<20)timer=setTimeout(check,3000)})};
    window.addEventListener("ra-vault-closed",closed);check();
    return()=>{active=false;if(timer)clearTimeout(timer);window.removeEventListener("ra-vault-closed",closed)};
  }, []);
  return h;
}

/** How far along a signal is (E1, E2): higher on the horizon the further along. */
export const ALONG: Partial<Record<SignalCard["kind"], number>> = { risen: 100, rising: 66, early: 33 };
export const KIND_LABEL: Partial<Record<SignalCard["kind"], string>> = { risen: "Risen", rising: "Rising", early: "Early","stays-human":"Stays human","on-ramp":"On-ramp" };
export const ON_THE_HORIZON: SignalCard["kind"][] = ["risen", "rising", "early"];
