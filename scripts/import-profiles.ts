/**
 * One-time (idempotent) import of the private two-profile payload into a Career Hub database.
 *
 *   npm run import:profiles -- [payload.json] [--db <path to careerhub.db>] [--storage <folder>]
 *
 * Defaults: payload = ./private-import/profiles.payload.json, db = %APPDATA%/Career Hub/careerhub.db (or ~/.config/Career Hub on macOS/Linux).
 * A copy of the database is made BEFORE anything is changed. Re-running never duplicates profiles or facts and never overwrites facts you edited.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb } from '../core/db.ts'
import { importPayload, loadPayloadFile } from '../core/twoprofile.ts'
import { slugify } from '../core/domain.ts'
import { getProfile } from '../core/profiles.ts'

const args = process.argv.slice(2)
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const payloadFile = path.resolve(positional[0] ?? 'private-import/profiles.payload.json')
const appData = process.env.APPDATA ?? (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'))
const userData = path.join(appData, 'Career Hub')
const dbFile = path.resolve(flag('--db') ?? path.join(userData, 'careerhub.db'))
const storage = flag('--storage') ?? path.join(os.homedir(), 'Documents', 'Career Hub')

if (!fs.existsSync(payloadFile)) { console.error(`Payload not found: ${payloadFile}\nPlace profiles.payload.json in private-import/ (git-ignored). See README → "Private profile import".`); process.exit(1) }
fs.mkdirSync(path.dirname(dbFile), { recursive: true })
if (fs.existsSync(dbFile)) {
  const bak = path.join(path.dirname(dbFile), 'backups'); fs.mkdirSync(bak, { recursive: true })
  const dest = path.join(bak, `pre-import-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.db`)
  fs.copyFileSync(dbFile, dest); for (const ext of ['-wal', '-shm']) if (fs.existsSync(dbFile + ext)) fs.copyFileSync(dbFile + ext, dest + ext)
  console.log(`Backup: ${dest}`)
}
const db = openDb(dbFile)
const { payload, dir } = loadPayloadFile(payloadFile)
const report = importPayload(db, payload, {
  payloadDir: dir, defaultStorageRoot: storage,
  originalsDir: (pid, name) => path.join(userData, 'profiles', `${slugify(getProfile(db, pid)!.name, 30)}__${pid}`, 'originals', name),
})
for (const r of report.profiles) console.log(`${r.key}: ${r.created ? 'created' : r.adopted ? 'adopted existing profile' : 'matched'} (${r.profile_id}) — +${r.added} added, ${r.updated} updated, ${r.skippedUserEdits} kept (your edits), ${r.unconfirmedLegacy} legacy parsed records set aside, ${r.unconfirmedStale} stale`)
db.close()
