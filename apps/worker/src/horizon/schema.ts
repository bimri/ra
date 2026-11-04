const migrations=[
  `CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY,kind TEXT NOT NULL,text TEXT NOT NULL,timing TEXT,sources TEXT NOT NULL,at INTEGER NOT NULL)`,
  `ALTER TABLE signals ADD COLUMN stays_human TEXT`,
  `ALTER TABLE signals ADD COLUMN seeded INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
  `ALTER TABLE signals ADD COLUMN direction TEXT`,
  `ALTER TABLE signals ADD COLUMN verification TEXT`,
  `CREATE TABLE IF NOT EXISTS horizon_refresh(week INTEGER PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,attempt INTEGER NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL,retry_at INTEGER,written INTEGER NOT NULL DEFAULT 0)`,
];
export function migrateHorizon(sql:SqlStorage):number{
  const meta=sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").toArray().length;
  const version=meta?Number(sql.exec<{value:string}>("SELECT value FROM meta WHERE key='schema'").toArray()[0]?.value??3):sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='signals'").toArray().length?1:0;
  for(let v=version;v<migrations.length;v++){
    try{sql.exec(migrations[v]!)}catch(error){if(![1,2,4,5].includes(v)||!String(error).includes("duplicate column"))throw error}
    if(v>=3)sql.exec("INSERT OR REPLACE INTO meta(key,value) VALUES('schema',?)",String(v+1));
  }
  return migrations.length;
}
