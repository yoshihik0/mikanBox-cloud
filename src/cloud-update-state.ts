export type CloudUpdatePhase = 'validating' | 'uploading' | 'migrating' | 'deploying' | 'verifying' | 'succeeded' | 'failed';

export interface CloudUpdateState {
  owner: string;
  version: string;
  phase: CloudUpdatePhase;
  message?: string;
  expires: number;
}

export interface CloudUpdateMigration {
  name: string;
  statements: readonly string[];
}

const LEASE_MS = 5 * 60 * 1000;
const CURRENT_TIME = "CAST(strftime('%s','now') AS INTEGER)*1000";
const LEASE_EXPIRY = `${CURRENT_TIME}+${LEASE_MS}`;
const OWNER_CONDITION = `json_extract(value,'$.owner')=? AND json_extract(value,'$.expires')>${CURRENT_TIME}`;
// This migration was already present in Cloud 0.20.3, the first supported update source.
const BASELINE = '0029_mcp_key_fingerprint.sql';

export async function acquireCloudUpdate(db: D1Database, version: string, owner: string): Promise<boolean> {
  const result = await db.prepare(`
    INSERT INTO settings(key,value)
    VALUES('cloud_update',json_object('owner',?,'version',?,'phase','validating','expires',${LEASE_EXPIRY}))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
    WHERE json_extract(settings.value,'$.expires')<=${CURRENT_TIME}
  `).bind(owner,version).run();
  return result.meta.changes > 0;
}

export async function readCloudUpdate(db: D1Database): Promise<CloudUpdateState | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key='cloud_update'").first<{value:string}>();
  return row ? JSON.parse(row.value) as CloudUpdateState : null;
}

function phaseUpdate(db: D1Database, owner: string, phase: CloudUpdatePhase, message: string): D1PreparedStatement {
  const expires = phase === 'succeeded' || phase === 'failed' ? '0' : LEASE_EXPIRY;
  return db.prepare(`
    UPDATE settings
    SET value=json_set(value,'$.phase',?,'$.message',?,'$.expires',${expires})
    WHERE key='cloud_update' AND ${OWNER_CONDITION}
  `).bind(phase,message,owner);
}

export async function setCloudUpdatePhase(
  db: D1Database, owner: string, phase: CloudUpdatePhase, message = ''
): Promise<void> {
  const result = await phaseUpdate(db,owner,phase,message).run();
  if (!result.meta.changes) throw new Error('The Cloud update lease expired. Restart the update.');
}

export async function applyCloudUpdateMigrations(
  db: D1Database, owner: string, migrations: readonly CloudUpdateMigration[]
): Promise<void> {
  const sorted = [...migrations].sort((a,b) => a.name.localeCompare(b.name));
  const numbers = new Set<string>();
  for (const migration of sorted) {
    const number = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(migration.name)?.[1];
    if (!number || numbers.has(number) || !migration.statements.length) {
      throw new Error('Invalid Cloud update migration list.');
    }
    numbers.add(number);
  }

  // Wrangler creates the ledger at install time and uses exact filenames to recognize applied files.
  const ledger = await db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='d1_migrations'").first();
  if (!ledger) throw new Error('The Wrangler migration ledger is missing. Use the manual update path.');
  const {results} = await db.prepare('SELECT name FROM d1_migrations').all<{name:string}>();
  const applied = new Set(results.map(row => row.name));
  if (!applied.has(BASELINE) || sorted.some(file => file.name.slice(0,4) <= BASELINE.slice(0,4) && !applied.has(file.name))) {
    throw new Error('The installed database schema is too old for this update. Use the manual update path.');
  }

  await setCloudUpdatePhase(db,owner,'migrating');
  for (const migration of sorted) {
    if (applied.has(migration.name)) continue;
    // The failing NOT NULL assertion aborts the whole D1 batch when another request owns the lease.
    // Wrangler also appends the ledger insert to the SQL for this file.
    const assertOwner = db.prepare(`
      INSERT INTO settings(key,value)
      SELECT 'cloud_update_invalid_lease',NULL
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key='cloud_update' AND ${OWNER_CONDITION})
    `).bind(owner);
    await db.batch([
      assertOwner,
      phaseUpdate(db,owner,'migrating',migration.name),
      ...migration.statements.map(sql => db.prepare(sql)),
      db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(migration.name)
    ]);
  }
}
