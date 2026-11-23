import fs from 'node:fs'
import path from 'node:path'
import { DB, all, get, run, tx, id, nowIso } from './db.ts'
import * as P from './profiles.ts'
import { sha256 } from './storage.ts'
import { slugify } from './domain.ts'

/**
 * One-time, idempotent import of curated profile data into the local private database.
 * The payload file itself is PERSONAL DATA and lives in the git-ignored `private-import/` folder (or the app's userData/import folder).
 * Nothing in this module contains any person's facts.
 */
export interface PayloadFact {
  key: string
  category: P.FactCategory
  title: string
  organization?: string
  date_start?: string; date_end?: string
  claim_text?: string
  tools?: string[]; metrics?: string[]
  details?: P.FactDetails
  status: P.FactStatus
  source_ref: string
  maturity?: string
  verified_on?: string
  /** Defaults to true unless status is NEEDS_CONFIRMATION. Unconfirmed facts never reach a resume, CV or email. */
  confirmed?: boolean
  sort_order?: number
}
export interface PayloadProfile {
  key: string                       // stable key: 'adam' | 'akif' (any slug)
  name: string                      // short display name
  tagline: string                   // e.g. "Data Science"
  badge: string                     // e.g. "Applying now"
  applyPlan?: string                // free text, display only
  identity: P.Identity
  roles: string[]; primary_role: string
  prefs?: P.Prefs
  source_files?: { file: string; kind?: 'MASTER_CV' | 'SUPPORT' }[]   // relative to the payload file
  facts: PayloadFact[]
}
export interface Payload { schema: 1; profiles: PayloadProfile[] }

export interface ImportReport { profiles: { key: string; profile_id: string; created: boolean; adopted: boolean; added: number; updated: number; skippedUserEdits: number; unconfirmedLegacy: number; unconfirmedStale: number }[] }

export function validatePayload(x: unknown): Payload {
  const p = x as Payload
  if (!p || p.schema !== 1 || !Array.isArray(p.profiles) || !p.profiles.length) throw new Error('Not a Career Hub profile payload (schema 1).')
  const keys = new Set<string>()
  for (const pr of p.profiles) {
    if (!/^[a-z0-9_-]{2,30}$/.test(pr.key)) throw new Error(`Invalid profile key "${pr.key}".`)
    if (keys.has(pr.key)) throw new Error(`Duplicate profile key "${pr.key}".`)
    keys.add(pr.key)
    const fk = new Set<string>()
    for (const f of pr.facts) {
      if (!f.key || fk.has(f.key)) throw new Error(`Profile ${pr.key}: missing or duplicate fact key "${f.key}".`)
      fk.add(f.key)
      if (!f.title || !f.status || !f.source_ref) throw new Error(`Profile ${pr.key}, fact ${f.key}: title, status and source_ref are required (every fact needs provenance).`)
    }
  }
  return p
}

const log = (db: DB, pid: string, key: string, action: string, summary: string) =>
  run(db, 'INSERT INTO fact_log (log_id, profile_id, fact_key, action, summary, created_at) VALUES (?,?,?,?,?,?)', id('fl'), pid, key, action, summary, nowIso())

/** Find the profile for a payload entry: by stable_key, else adopt an existing profile with the same name/slug or identical email (so nothing is duplicated and history is kept). */
function reconcileProfile(db: DB, pr: PayloadProfile): { profile_id: string; created: boolean; adopted: boolean } {
  const byKey = get<any>(db, 'SELECT profile_id FROM profiles WHERE stable_key=?', pr.key)
  if (byKey) return { profile_id: byKey.profile_id, created: false, adopted: false }
  const email = pr.identity.email?.toLowerCase()
  const candidates = all<any>(db, 'SELECT profile_id, name, slug, identity_json FROM profiles WHERE stable_key IS NULL')
  const match = candidates.find((c) => {
    let e = ''
    try { e = (JSON.parse(c.identity_json).email ?? '').toLowerCase() } catch { /* ignore */ }
    return (email && e === email) || c.slug === slugify(pr.name) || c.slug === pr.key
  })
  if (match) { run(db, 'UPDATE profiles SET stable_key=? WHERE profile_id=?', pr.key, match.profile_id); return { profile_id: match.profile_id, created: false, adopted: true } }
  const profile_id = `pr_${pr.key}`
  const t = nowIso()
  run(db, 'INSERT INTO profiles (profile_id, name, slug, stable_key, identity_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', profile_id, pr.name, slugify(pr.name), pr.key, '{}', t, t)
  return { profile_id, created: true, adopted: false }
}

export function importPayload(db: DB, payload: Payload, opts: { payloadDir?: string; originalsDir?: (profileId: string, name: string) => string; defaultStorageRoot?: string } = {}): ImportReport {
  const report: ImportReport = { profiles: [] }
  tx(db, () => {
    for (const pr of payload.profiles) {
      const { profile_id, created, adopted } = reconcileProfile(db, pr)
      const cur = P.getProfile(db, profile_id)!
      P.updateProfile(db, profile_id, {
        name: pr.name, roles: pr.roles, primary_role: pr.primary_role, career_types: ['INTERNSHIP'], region: 'Cyberjaya',
        identity: pr.identity, prefs: { ...(pr.prefs ?? {}), tagline: pr.tagline, badge: pr.badge, applyPlan: pr.applyPlan },
        onboarding_done: true, onboarding_step: 4,
        ...(!cur.storage_root && opts.defaultStorageRoot ? { storage_root: opts.defaultStorageRoot } : {}),
      })
      const r = { key: pr.key, profile_id, created, adopted, added: 0, updated: 0, skippedUserEdits: 0, unconfirmedLegacy: 0, unconfirmedStale: 0 }

      // Facts. Idempotent by import_key; a fact the user has edited is never overwritten.
      const seen = new Set<string>()
      pr.facts.forEach((f, i) => {
        seen.add(f.key)
        const confirmed = f.confirmed ?? f.status !== 'NEEDS_CONFIRMATION'
        const row = get<any>(db, 'SELECT * FROM facts WHERE profile_id=? AND import_key=?', profile_id, f.key)
        const input: P.FactInput = {
          category: f.category, title: f.title, organization: f.organization ?? null, date_start: f.date_start ?? null, date_end: f.date_end ?? null,
          claim_text: f.claim_text ?? '', tools: f.tools ?? [], metrics: f.metrics ?? [], source_citation: f.source_ref, confidence: f.status === 'DOCUMENTED' ? 'high' : 'medium',
          confirmed, details: f.details ?? {}, sort_order: f.sort_order ?? i, status: f.status, source_ref: f.source_ref, verified_on: f.verified_on ?? null, maturity: f.maturity ?? null, import_key: f.key,
        }
        if (!row) { P.addFact(db, profile_id, input); log(db, profile_id, f.key, 'IMPORT_ADD', `Added "${f.title}" [${f.status}] from ${f.source_ref}`); r.added++; return }
        if (row.user_override) {
          if (get(db, `SELECT 1 FROM fact_log WHERE profile_id=? AND fact_key=? AND action='IMPORT_SKIP_USER_EDIT'`, profile_id, f.key) == null) log(db, profile_id, f.key, 'IMPORT_SKIP_USER_EDIT', `Kept your edited version of "${row.title}"`)
          r.skippedUserEdits++; return
        }
        const next = JSON.stringify([input.title, input.organization, input.date_start, input.date_end, input.claim_text, input.tools, input.metrics, P.cleanDetails(input.details), input.status, input.source_ref, input.maturity, confirmed ? 1 : 0, input.sort_order])
        const prev = JSON.stringify([row.title, row.organization, row.date_start, row.date_end, row.claim_text, JSON.parse(row.tools_json), JSON.parse(row.metrics_json), P.hydrateFact(row).details, row.status, row.source_ref, row.maturity, row.confirmed, row.sort_order])
        if (next === prev) return
        run(db, `UPDATE facts SET category=?, title=?, organization=?, date_start=?, date_end=?, claim_text=?, tools_json=?, metrics_json=?, source_citation=?, confidence=?, confirmed=?, details_json=?, sort_order=?, status=?, source_ref=?, verified_on=?, maturity=?, updated_at=? WHERE fact_id=?`,
          input.category, input.title, input.organization, input.date_start, input.date_end, input.claim_text, JSON.stringify(input.tools), JSON.stringify(input.metrics), input.source_citation, input.confidence, confirmed ? 1 : 0, JSON.stringify(P.cleanDetails(input.details)), input.sort_order, input.status, input.source_ref, input.verified_on, input.maturity, nowIso(), row.fact_id)
        log(db, profile_id, f.key, 'IMPORT_UPDATE', `Updated "${f.title}" [${f.status}]`); r.updated++
      })

      // Facts from an earlier import that the payload no longer contains: keep them, but take them out of every document.
      for (const row of all<any>(db, 'SELECT * FROM facts WHERE profile_id=? AND import_key IS NOT NULL AND confirmed=1 AND user_override=0', profile_id)) {
        if (seen.has(row.import_key)) continue
        run(db, 'UPDATE facts SET confirmed=0 WHERE fact_id=?', row.fact_id); log(db, profile_id, row.import_key, 'IMPORT_UPDATE', `"${row.title}" is no longer in the payload; un-confirmed (kept)`); r.unconfirmedStale++
      }
      // Pre-existing records (from the old CV parser) that were never imported or edited are superseded. Kept and recoverable, but not used in documents.
      if (adopted) {
        for (const row of all<any>(db, 'SELECT * FROM facts WHERE profile_id=? AND import_key IS NULL AND confirmed=1 AND user_override=0', profile_id)) {
          run(db, 'UPDATE facts SET confirmed=0 WHERE fact_id=?', row.fact_id)
          log(db, profile_id, row.fact_id, 'IMPORT_UPDATE', `Legacy parsed record "${row.title}" superseded by curated import; un-confirmed (kept)`); r.unconfirmedLegacy++
        }
      }

      // Original source files: copied untouched, recorded with SHA-256 (no OCR, no re-parse).
      for (const sf of pr.source_files ?? []) {
        const src = path.resolve(opts.payloadDir ?? '.', sf.file)
        if (!fs.existsSync(src)) continue
        const buf = fs.readFileSync(src); const sha = sha256(buf)
        if (get(db, 'SELECT 1 FROM source_documents WHERE profile_id=? AND sha256=?', profile_id, sha)) continue
        const dest = opts.originalsDir ? opts.originalsDir(profile_id, path.basename(src)) : src
        if (dest !== src) { fs.mkdirSync(path.dirname(dest), { recursive: true }); if (!fs.existsSync(dest)) fs.copyFileSync(src, dest) }
        run(db, `INSERT INTO source_documents (doc_id, profile_id, kind, original_name, stored_path, sha256, text_content, created_at) VALUES (?,?,?,?,?,?,?,?)`, id('sd'), profile_id, sf.kind ?? 'MASTER_CV', path.basename(src), dest, sha, '', nowIso())
      }
      report.profiles.push(r)
    }
    // Remember nothing as "active" here: the picker always asks first.
  })
  return report
}

/** Locations checked for a payload, in order. */
export const payloadCandidates = (userDataDir: string, cwd = process.cwd()) => [
  process.env.CAREER_HUB_PAYLOAD ?? '',
  path.join(userDataDir, 'import', 'profiles.payload.json'),
  path.join(cwd, 'private-import', 'profiles.payload.json'),
].filter(Boolean)

export function loadPayloadFile(file: string): { payload: Payload; dir: string } {
  return { payload: validatePayload(JSON.parse(fs.readFileSync(file, 'utf8'))), dir: path.dirname(file) }
}
