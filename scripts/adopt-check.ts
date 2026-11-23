/**
 * Dry-run of the one-time import against a COPY of an existing database, so the real one is never touched.
 *   node scripts/run-debug.mjs scripts/adopt-check.ts <path to existing careerhub.db> <payload.json>
 * Reports what an import would do to existing profiles, facts and applications.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb, all } from '../core/db.ts'
import { importPayload, loadPayloadFile } from '../core/twoprofile.ts'

const [src, payloadFile] = process.argv.slice(2)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-')); const copy = path.join(tmp, 'careerhub.db')
fs.copyFileSync(src, copy); for (const e of ['-wal', '-shm']) if (fs.existsSync(src + e)) fs.copyFileSync(src + e, copy + e)
const snap = (db: any) => ({
  profiles: all(db, 'SELECT profile_id, name, stable_key FROM profiles'),
  facts: all(db, 'SELECT profile_id, SUM(confirmed) confirmed, COUNT(*) total FROM facts GROUP BY profile_id'),
  apps: all(db, 'SELECT company_name, role_title, status, applied_at IS NOT NULL applied FROM applications ORDER BY created_at'),
  sources: all(db, 'SELECT profile_id, COUNT(*) n FROM source_documents GROUP BY profile_id'),
})
let db = openDb(copy)
const before = snap(db)
const { payload, dir } = loadPayloadFile(path.resolve(payloadFile))
const r1 = importPayload(db, payload, { payloadDir: dir, defaultStorageRoot: path.join(tmp, 'Career Hub'), originalsDir: (pid, n) => path.join(tmp, 'originals', pid, n) })
const after = snap(db)
const r2 = importPayload(db, payload, { payloadDir: dir, defaultStorageRoot: path.join(tmp, 'Career Hub'), originalsDir: (pid, n) => path.join(tmp, 'originals', pid, n) })
const again = snap(db)
console.log(JSON.stringify({ migratedTo: (db.prepare('PRAGMA user_version').get() as any).user_version, before, report: r1, after, rerunReport: r2.profiles.map((p) => ({ key: p.key, added: p.added, updated: p.updated, created: p.created })), idempotent: JSON.stringify(after) === JSON.stringify(again), backups: fs.readdirSync(tmp).filter((f) => f.endsWith('.bak')) }, null, 1))
