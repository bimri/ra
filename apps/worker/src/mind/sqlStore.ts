import type { EventStore, RaEvent } from "@ra/core";
import type { Cipher } from "../crypto/seal";

type Row = { seq: number; id: string; kind: string; at: number; device: string; body: string };

/**
 * The Mind's event table behind the shared EventLog. Bodies are sealed with
 * the person's data key; seq, id, kind, time and device stay readable, so the
 * log can be ordered and synced without opening anything.
 */
export class SqlEventStore implements EventStore {
  constructor(
    private readonly sql: SqlStorage,
    private readonly cipher: Cipher,
  ) {}

  lastSeq(): number {
    return this.sql.exec<{ s: number }>("SELECT COALESCE(MAX(seq), 0) AS s FROM events").one().s;
  }

  has(id: string): boolean {
    return this.sql.exec("SELECT 1 FROM events WHERE id = ?", id).toArray().length > 0;
  }

  byId(id:string):RaEvent|undefined {
    const row=this.sql.exec<Row>("SELECT seq, id, kind, at, device, body FROM events WHERE id = ?",id).toArray()[0];
    return row?{seq:row.seq,id:row.id,kind:row.kind,at:row.at,device:row.device,body:JSON.parse(this.cipher.open(row.body))} as RaEvent:undefined;
  }

  insert(e: RaEvent): void {
    this.sql.exec(
      "INSERT INTO events (seq, id, kind, at, device, body) VALUES (?, ?, ?, ?, ?, ?)",
      e.seq,
      e.id,
      e.kind,
      e.at,
      e.device,
      this.cipher.seal(JSON.stringify(e.body)),
    );
  }

  /** Events of these kinds, for a rewrite pass (I2 forgetting). */
  ofKinds(kinds: string[]): RaEvent[] {
    return this.sql
      .exec<Row>(`SELECT seq, id, kind, at, device, body FROM events WHERE kind IN (${kinds.map(() => "?").join(",")}) ORDER BY seq`, ...kinds)
      .toArray()
      .map((r) => ({ seq: r.seq, id: r.id, kind: r.kind, at: r.at, device: r.device, body: JSON.parse(this.cipher.open(r.body)) }) as RaEvent);
  }

  /** Replace one event's body. Only forgetting does this; the log is otherwise append-only. */
  rewrite(e: RaEvent): void {
    this.sql.exec("UPDATE events SET body = ? WHERE seq = ?", this.cipher.seal(JSON.stringify(e.body)), e.seq);
  }

  since(seq: number, limit = 1000): RaEvent[] {
    return this.sql
      .exec<Row>("SELECT seq, id, kind, at, device, body FROM events WHERE seq > ? ORDER BY seq LIMIT ?", seq, limit)
      .toArray()
      .map(
        (r) =>
          ({ seq: r.seq, id: r.id, kind: r.kind, at: r.at, device: r.device, body: JSON.parse(this.cipher.open(r.body)) }) as RaEvent,
      );
  }
}
