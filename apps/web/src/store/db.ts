import { sealLocal, openLocal, localValueDigest, vaultAccount, vaultEpoch, type Envelope } from "../auth/vault";
import type { EventDraft, RaEvent, Views } from "@ra/core";
import { devPerson } from "./device";

// The phone's copy of your Mind, in IndexedDB: the events it has seen, an
// outbox of events made here and not yet synced, and the computed views.
// Every operation stays bound to the account and unlock session it began in.

// One copy per Mind, so a dev phone switching to the demo mind never mixes the two.
const BASE_NAME = devPerson() === "dev" ? "ra-mind" : `ra-mind-${devPerson()}`;
const VERSION = 2;

const OWNER_KEY = "__ra_account_owner_v1";
const MIGRATION_KEY="__ra_encryption_migration_v2";
export function localSession() {
  const owner = vaultAccount(); const epoch = vaultEpoch();
  if (!owner) throw new Error("Unlock the local copy first.");
  return { owner, epoch };
}
type Session = ReturnType<typeof localSession>;
export function checkLocalSession(session: Session): void {
  if (vaultAccount() !== session.owner || vaultEpoch() !== session.epoch) throw new Error("The local copy was locked or the account changed.");
}
function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const has = (name: string) => db.objectStoreNames.contains(name);
      if (!has("events")) db.createObjectStore("events", { keyPath: "seq" });
      if (!has("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
      if (!has("kv")) db.createObjectStore("kv");
      // v2: clips (a held thought, a bring-back) waiting for a connection (J2).
      if (!has("clips")) db.createObjectStore("clips", { keyPath: "id" });
    };
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
}

let dbp: { owner: string; factory: IDBFactory; value: Promise<IDBDatabase> } | null = null;
// The transaction serializes the first legacy claim across tabs. localStorage is
// only an upgrade hint; its get/set pair cannot establish ownership atomically.
async function ownedDatabase(owner: string): Promise<IDBDatabase> {
  const legacy = await open(BASE_NAME);
  const bound = await new Promise<string>((resolve, reject) => {
    const t = legacy.transaction("kv", "readwrite"); const kv = t.objectStore("kv");
    let binding: string;
    const q = kv.get(OWNER_KEY);
    q.onsuccess = () => {
      binding = typeof q.result === "string" ? q.result : localStorage.getItem("ra.db-owner." + BASE_NAME) ?? owner;
      if (q.result === undefined) kv.put(binding, OWNER_KEY);
    };
    t.oncomplete = () => resolve(binding);
    t.onerror = t.onabort = () => reject(t.error ?? new Error("Local account binding failed."));
  });
  if (bound === owner) return legacy;
  legacy.close();
  return open(BASE_NAME + "-" + encodeURIComponent(owner));
}
async function db(session: Session): Promise<IDBDatabase> {
  checkLocalSession(session);
  if (!dbp || dbp.owner !== session.owner || dbp.factory !== indexedDB) {
    if (dbp) void dbp.value.then(d => d.close(), () => {});
    const entry = { owner: session.owner, factory: indexedDB, value: ownedDatabase(session.owner) };
    dbp = entry;
    void entry.value.catch(() => { if (dbp === entry) dbp = null; });
  }
  const d = await dbp.value;
  checkLocalSession(session);
  return d;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void, session = localSession()): Promise<T> {
  return db(session).then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        checkLocalSession(session);
        const t = d.transaction(store, mode);
        const locked = () => { try { t.abort(); } catch { /* already complete */ } };
        window.addEventListener("ra-vault-closed", locked);
        const cleanup = () => window.removeEventListener("ra-vault-closed", locked);
        let req: IDBRequest<T> | void;
        t.oncomplete = () => { cleanup(); try { checkLocalSession(session); resolve(req ? req.result : (undefined as T)); } catch(e) { reject(e); } };
        t.onerror = t.onabort = () => { cleanup(); reject(t.error ?? new Error("The local operation was cancelled.")); };
        try { req = run(t.objectStore(store)); } catch (error) { t.abort(); reject(error); }
      }),
  );
}

type Row = { id?: string; seq?: number; encrypted: Envelope };
export type ExportRowRef={table:"events"|"outbox"|"clips"|"kv";key:IDBValidKey;iv:string;length:number};
/** Snapshot only identities/revisions, never all encrypted media or decrypted rows in memory. */
export async function exportIndex():Promise<ExportRowRef[]> {
  const session=localSession();const database=await db(session);checkLocalSession(session);
  return new Promise((resolve,reject)=>{
    const tables=["events","outbox","clips","kv"] as const;const transaction=database.transaction(tables.slice(),"readonly");const refs:ExportRowRef[]=[];
    const locked=()=>{try{transaction.abort()}catch{/* finished */}};window.addEventListener("ra-vault-closed",locked);
    const cleanup=()=>window.removeEventListener("ra-vault-closed",locked);
    transaction.onerror=transaction.onabort=()=>{cleanup();reject(transaction.error??new Error("The export snapshot was interrupted."))};
    transaction.oncomplete=()=>{cleanup();try{checkLocalSession(session);resolve(refs.sort((a,b)=>tables.indexOf(a.table)-tables.indexOf(b.table)||indexedDB.cmp(a.key,b.key)))}catch(error){reject(error)}};
    for(const table of tables) {
      const request=transaction.objectStore(table).openCursor();request.onsuccess=()=>{
        const cursor=request.result;if(!cursor)return;
        if(!(table==="kv"&&(cursor.key===OWNER_KEY||cursor.key===MIGRATION_KEY))) {
          const envelope=(table==="kv"?cursor.value:cursor.value?.encrypted) as Envelope|undefined;
          if(!envelope||envelope.sealed!==1||typeof envelope.iv!=="string"||typeof envelope.data!=="string"){transaction.abort();return}
          refs.push({table,key:cursor.key,iv:envelope.iv,length:envelope.data.length});
        }
        cursor.continue();
      };
    }
  });
}
export async function readExportRow(ref:ExportRowRef):Promise<unknown> {
  const session=localSession();if(ref.table==="kv"&&ref.key===OWNER_KEY)throw new Error("Reserved local metadata.");
  const row=await tx<unknown>(ref.table,"readonly",s=>s.get(ref.key),session);
  const envelope=(ref.table==="kv"?row:(row as Row|undefined)?.encrypted) as Envelope|undefined;
  if(!envelope||envelope.iv!==ref.iv||envelope.data.length!==ref.length)throw new Error("The local copy changed during export. Start a fresh export to include the latest work.");
  const value=await openLocal(envelope,ref.table+":"+String(ref.key));checkLocalSession(session);return value;
}
const recordKey = (table: string, row: { id?: string; seq?: number }) => table === "events" ? row.seq : row.id;
const recordIndex = (table: string, row: { id?: string; seq?: number }) => table === "events" ? { seq: row.seq } : { id: row.id };
async function readRows<T>(table: string, session = localSession()): Promise<T[]> {
  const rows = await tx<unknown[]>(table, "readonly", (s) => s.getAll(), session);
  checkLocalSession(session);
  const values = await Promise.all(rows.map(async (r) => {
    const row = r as Row;
    return row.encrypted ? openLocal<T>(row.encrypted, table + ":" + recordKey(table, row)) : r as T;
  }));
  checkLocalSession(session);
  return values;
}
async function putRows(table: string, rows: ({ id?: string; seq?: number })[], session = localSession()): Promise<void> {
  const sealed = await Promise.all(rows.map(async (row) => ({ ...recordIndex(table, row), encrypted: await sealLocal(row, table + ":" + recordKey(table, row)) })));
  await tx<void>(table, "readwrite", (s) => { for (const row of sealed) s.put(row); }, session);
}
const isEnvelope=(value:unknown):value is Envelope=>!!value&&typeof value==="object"&&(value as Envelope).sealed===1&&typeof (value as Envelope).iv==="string"&&typeof (value as Envelope).data==="string";
/** Hold a short exclusive record-store transaction while comparing Blob content.
 * A keepalive request keeps the transaction active; all writes happen in IDB
 * callbacks. A changed/deleted legacy record is preserved, never overwritten. */
async function replaceLegacy(table:string,key:IDBValidKey,expected:string,replacement:unknown,session:Session):Promise<boolean>{
  const database=await db(session);checkLocalSession(session);
  return new Promise((resolve,reject)=>{
    const transaction=database.transaction(table,"readwrite"),object=transaction.objectStore(table);let matches=false,failure:unknown,ready=false,result=true;
    const timeout=setTimeout(()=>{failure=new Error("Local migration timed out. Your original work is still kept.");try{transaction.abort()}catch{}},10_000);
    const locked=()=>{failure=new Error("The local copy was locked.");try{transaction.abort()}catch{}};window.addEventListener("ra-vault-closed",locked);
    const cleanup=()=>{clearTimeout(timeout);window.removeEventListener("ra-vault-closed",locked)};
    transaction.oncomplete=()=>{cleanup();try{checkLocalSession(session);resolve(result)}catch(error){reject(error)}};
    transaction.onerror=transaction.onabort=()=>{cleanup();reject(failure??transaction.error??new Error("Local migration was interrupted."))};
    const query=object.get(key);query.onsuccess=()=>{
      const value=query.result;if(value===undefined||isEnvelope(table==="kv"?value:value?.encrypted))return;
      void localValueDigest(value).then(digest=>{matches=digest===expected;ready=true},error=>{failure=error;ready=true});
      const complete=()=>{try{checkLocalSession(session);if(ready){if(failure){transaction.abort();return}result=matches;if(matches)object.put(replacement,...(table==="kv"?[key]:[]));return}const keep=object.count();keep.onsuccess=complete}catch(error){failure=error;transaction.abort()}};complete();
    };
  });
}
async function finishMigration(session:Session,completed:Envelope):Promise<boolean>{
  const database=await db(session);checkLocalSession(session);
  return new Promise((resolve,reject)=>{
    const tables=["events","outbox","clips","kv"],transaction=database.transaction(tables,"readwrite");let legacy=false,remaining=tables.length;
    const locked=()=>{try{transaction.abort()}catch{}};window.addEventListener("ra-vault-closed",locked);
    const cleanup=()=>window.removeEventListener("ra-vault-closed",locked);
    transaction.oncomplete=()=>{cleanup();try{checkLocalSession(session);resolve(!legacy)}catch(error){reject(error)}};
    transaction.onerror=transaction.onabort=()=>{cleanup();reject(transaction.error??new Error("Migration verification was interrupted."))};
    const done=()=>{if(--remaining===0&&!legacy)transaction.objectStore("kv").put(completed,MIGRATION_KEY)};
    for(const table of tables){const query=transaction.objectStore(table).openCursor();query.onsuccess=()=>{const cursor=query.result;if(!cursor||legacy){done();return}if(!(table==="kv"&&(cursor.key===OWNER_KEY||cursor.key===MIGRATION_KEY))&&!isEnvelope(table==="kv"?cursor.value:cursor.value?.encrypted)){legacy=true;done();return}cursor.continue()}}
  });
}
/** Each row is verified and compared under a write lock before plaintext is
 * replaced. Ciphertext itself is resumable progress; the checkpoint is sealed. */
export async function migrateLocal(): Promise<void> {
  const session = localSession();
  const checkpoint=async(stage:string,complete=false)=>{const encrypted=await sealLocal({version:2,stage,complete},"kv:"+MIGRATION_KEY);await tx<void>("kv","readwrite",s=>{s.put(encrypted,MIGRATION_KEY)},session)};
  await checkpoint("starting");
  for(let pass=0;pass<3;pass++){
    let conflicts=0;
    for(const table of ["events","outbox","clips","kv"]){
      await checkpoint(table);let after:IDBValidKey|undefined;
      for(;;){const keys=await tx<IDBValidKey[]>(table,"readonly",s=>s.getAllKeys(after===undefined?undefined:IDBKeyRange.lowerBound(after,true),32),session);if(!keys.length)break;
        for(const key of keys){if(table==="kv"&&(key===OWNER_KEY||key===MIGRATION_KEY))continue;
          const value=await tx<unknown>(table,"readonly",s=>s.get(key),session);if(value===undefined)continue;
          const envelope=table==="kv"?value:(value as Row)?.encrypted,context=table+":"+String(key);
          if(isEnvelope(envelope)){await openLocal(envelope,context);checkLocalSession(session);if(table!=="kv"&&Object.keys(value as object).some(name=>![table==="events"?"seq":"id","encrypted"].includes(name)))throw new Error("A local record contains both encrypted and older fields. Both copies were preserved for review.");continue}
          const expected=await localValueDigest(value),encrypted=await sealLocal(value,context),opened=await openLocal(encrypted,context);
          if(await localValueDigest(opened)!==expected)throw new Error("The encrypted copy did not verify. Your original work is still kept.");
          checkLocalSession(session);const replacement=table==="kv"?encrypted:{...recordIndex(table,value as Row),encrypted};
          if(!await replaceLegacy(table,key,expected,replacement,session))conflicts++;
        }
        after=keys.at(-1);if(keys.length<32)break;
      }
    }
    if(!conflicts){const completed=await sealLocal({version:2,stage:"complete",complete:true},"kv:"+MIGRATION_KEY);if(await finishMigration(session,completed))return}
  }
  await checkpoint("conflict");throw new Error("Another Ra tab is still changing the local copy. Close it and unlock again; your work has been kept.");
}
export const store = {
  allEvents: () => readRows<RaEvent>("events"),
  putEvents: (rows: RaEvent[]) => putRows("events", rows),
  outbox: () => readRows<EventDraft>("outbox"),
  queue: (row: EventDraft) => putRows("outbox", [row]),
  unqueue: (ids: string[]) => tx<void>("outbox", "readwrite", (s) => { for (const id of ids) s.delete(id); }),
  clips: () => readRows<QueuedClip>("clips"),
  queueClip: (row: QueuedClip) => putRows("clips", [row]),
  clip: async (id:string):Promise<QueuedClip|undefined> => {
    const session=localSession(); const row=await tx<Row|undefined>("clips","readonly",s=>s.get(id),session);
    const value=row ? row.encrypted ? await openLocal<QueuedClip>(row.encrypted,"clips:"+id) : row as unknown as QueuedClip : undefined;
    checkLocalSession(session);return value;
  },
  /** Compare ciphertext after encryption: a late inference cannot revive a deleted/changed capture. */
  updateClip: async (id:string,update:(current:QueuedClip)=>QueuedClip):Promise<QueuedClip|null> => {
    const session=localSession();const previous=await tx<Row|undefined>("clips","readonly",s=>s.get(id),session);
    if(!previous?.encrypted)return null;
    const current=await openLocal<QueuedClip>(previous.encrypted,"clips:"+id);checkLocalSession(session);
    const next=update(current);if(next.id!==id)throw new Error("Capture identity changed.");
    const encrypted=await sealLocal(next,"clips:"+id);let saved=false;
    await tx<void>("clips","readwrite",s=>{const q=s.get(id);q.onsuccess=()=>{
      if(q.result?.encrypted?.iv===previous.encrypted.iv&&q.result?.encrypted?.data===previous.encrypted.data){s.put({id,encrypted});saved=true;}
    };},session);
    return saved?next:null;
  },
  unqueueClip: (id: string) => tx("clips", "readwrite", (s) => s.delete(id)),
  get: async <T>(key: string): Promise<T | undefined> => {
    if (key === OWNER_KEY) throw new Error("Reserved local metadata.");
    const session = localSession();
    const value = await tx<Envelope | T | undefined>("kv", "readonly", (s) => s.get(key), session);
    const plain = value && typeof value === "object" && "sealed" in value ? await openLocal<T>(value as Envelope, "kv:" + key) : value as T | undefined;
    checkLocalSession(session); return plain;
  },
  set: async (key: string, value: unknown) => { if (key === OWNER_KEY) throw new Error("Reserved local metadata."); const session = localSession(); const encrypted = await sealLocal(value, "kv:" + key); return tx("kv", "readwrite", (s) => s.put(encrypted, key), session); },
  reset: async () => { const session = localSession(); await tx("events", "readwrite", (s) => s.clear(), session); await tx<void>("kv", "readwrite", (s) => { const q = s.openCursor(); q.onsuccess = () => { const cursor = q.result; if (cursor) { if (cursor.key !== OWNER_KEY) cursor.delete(); cursor.continue(); } }; }, session); },
  wipe: async () => {
    const session = localSession(); const d = await db(session); const name = d.name;
    checkLocalSession(session); d.close(); dbp = null;
    await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(name); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error("Close other Ra tabs before erasing.")); });
    checkLocalSession(session);
  },
};

export type SavedViews = { views: Views; version: number };

/** A clip that couldn't be sent yet: the request to make once there's a connection. */
export interface QueuedClip {
  id: string;
  /** "/capture" (C2) or "/evidence" (C3). */
  path: string;
  fields: Record<string, string>;
  files: Record<string, Blob>;
  /** For J2's "Waiting to send". */
  label: string;
  ms: number;
  at: number;
}
