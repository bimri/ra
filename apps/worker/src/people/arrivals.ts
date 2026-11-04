import type { Env } from "../env";
import { holderOf } from "../ledger";
import { people } from "./routes";

/** Repeatable delivery after a confirmed arrival; disclosure is a separate choice. */
export async function deliverArrivals(env: Env, who: string): Promise<void> {
  const mind = env.MIND.getByName(who);
  const holder = await holderOf(env,who);
  for (const arrival of await mind.pendingArrivals()) {
    await env.LEDGER.prepare("UPDATE voyages SET state = 'landed', closed_at = ? WHERE holder = ? AND island = ? AND state = 'open' AND started_at <= ?").bind(arrival.at,holder,arrival.island,arrival.at).run();
    if (arrival.witnesses.length) {
      const response = await people(new Request("https://ra.internal/people/witness/ask",{ method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ landfallId:arrival.landfallId,introIds:arrival.witnesses,text:"A landfall: " + arrival.island }) }),env,"/people/witness/ask",who);
      if (!response?.ok) throw new Error("Witness invitations are waiting to be delivered.");
    }
    await mind.arrivalDelivered(arrival.landfallId);
  }
}
