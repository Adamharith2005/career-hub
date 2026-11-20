import { DB, all, get, run, id, nowIso, tx } from './db.ts'
import { safeParse, slugify } from './domain.ts'

export interface Prefs {
  internshipStart?: string; internshipEnd?: string; durationWeeks?: number
  workMode?: 'onsite' | 'hybrid' | 'remote' | ''
  expectation?: string; university?: string; graduation?: string
  language?: 'en' | 'ms'; theme?: 'light' | 'dark' | 'system'; citizenship?: 'malaysian' | 'other' | ''
}
export interface Identity {
  fullName?: string; email?: string; phone?: string; location?: string
  linkedin?: string; github?: string; portfolio?: string
}

export function hydrateProfile(r: any) {
  return {
    ...r,
    roles: safeParse<string[]>(r.roles_json, []),
    career_types: safeParse<string[]>(r.career_types_json, []),
    prefs: safeParse<Prefs>(r.prefs_json, {}),
    identity: safeParse<Identity>(r.identity_json, {}),
  }
}
export type Profile = ReturnType<typeof hydrateProfile>

export function createProfile(db: DB, name: string): Profile {
  const n = name.trim()
  if (!n) throw new Error('Please enter a profile name.')
  const profile_id = id('pr')
  const t = nowIso()
  run(db, `INSERT INTO profiles (profile_id, name, slug, identity_json, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    profile_id, n, slugify(n), JSON.stringify({ fullName: n }), t, t)
  if (!getActiveProfileId(db)) setActiveProfile(db, profile_id)
  return getProfile(db, profile_id)!
}

export const listProfiles = (db: DB) => all(db, 'SELECT * FROM profiles ORDER BY created_at').map(hydrateProfile)
export const getProfile = (db: DB, profileId: string) => { const r = get(db, 'SELECT * FROM profiles WHERE profile_id = ?', profileId); return r ? hydrateProfile(r) : null }
export const getActiveProfileId = (db: DB) => get<{ value: string }>(db, `SELECT value FROM app_state WHERE key='active_profile'`)?.value ?? null
export function setActiveProfile(db: DB, profileId: string) {
  if (!getProfile(db, profileId)) throw new Error('Unknown profile')
  run(db, `INSERT INTO app_state (key,value) VALUES ('active_profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, profileId)
}

export function updateProfile(db: DB, profileId: string, patch: Partial<{
  name: string; roles: string[]; primary_role: string | null; other_role_text: string | null; career_types: string[]; region: string
  prefs: Prefs; identity: Identity; storage_root: string | null; onboarding_step: number; onboarding_done: boolean
}>) {
  const cur = getProfile(db, profileId)
  if (!cur) throw new Error('Unknown profile')
  const next = {
    name: patch.name ?? cur.name,
    roles: patch.roles ?? cur.roles,
    primary_role: patch.primary_role !== undefined ? patch.primary_role : cur.primary_role,
    other_role_text: patch.other_role_text !== undefined ? patch.other_role_text : cur.other_role_text,
    career_types: patch.career_types ?? cur.career_types,
    region: patch.region ?? cur.region,
    prefs: { ...cur.prefs, ...(patch.prefs ?? {}) },
    identity: { ...cur.identity, ...(patch.identity ?? {}) },
    storage_root: patch.storage_root !== undefined ? patch.storage_root : cur.storage_root,
    onboarding_step: patch.onboarding_step ?? cur.onboarding_step,
    onboarding_done: patch.onboarding_done !== undefined ? (patch.onboarding_done ? 1 : 0) : cur.onboarding_done,
  }
  if (next.roles.length && (!next.primary_role || !next.roles.includes(next.primary_role))) next.primary_role = next.roles[0]
  run(db, `UPDATE profiles SET name=?, slug=?, roles_json=?, primary_role=?, other_role_text=?, career_types_json=?, region=?, prefs_json=?, identity_json=?,
           storage_root=?, onboarding_step=?, onboarding_done=?, updated_at=? WHERE profile_id=?`,
    next.name, slugify(next.name), JSON.stringify(next.roles), next.primary_role, next.other_role_text, JSON.stringify(next.career_types), next.region,
    JSON.stringify(next.prefs), JSON.stringify(next.identity), next.storage_root, next.onboarding_step, next.onboarding_done, nowIso(), profileId)
  return getProfile(db, profileId)!
}

export function deleteProfile(db: DB, profileId: string) {
  tx(db, () => {
    run(db, 'DELETE FROM profiles WHERE profile_id = ?', profileId) // cascades to every owned table
    const active = getActiveProfileId(db)
    if (active === profileId) {
      const other = listProfiles(db)[0]
      if (other) setActiveProfile(db, other.profile_id); else run(db, `DELETE FROM app_state WHERE key='active_profile'`)
    }
  })
}

export const getSetting = (db: DB, profileId: string, key: string, fallback = '') =>
  get<{ value: string }>(db, 'SELECT value FROM settings WHERE profile_id=? AND key=?', profileId, key)?.value ?? fallback
export const setSetting = (db: DB, profileId: string, key: string, value: string) =>
  run(db, `INSERT INTO settings (profile_id,key,value) VALUES (?,?,?) ON CONFLICT(profile_id,key) DO UPDATE SET value=excluded.value`, profileId, key, value)

// ------------------------------------------------------------------ facts
export type FactCategory = 'EDUCATION' | 'SKILL' | 'PROJECT' | 'EXPERIENCE' | 'LEADERSHIP' | 'CERTIFICATION' | 'AWARD' | 'LANGUAGE' | 'LINK'
export interface Fact {
  fact_id: string; profile_id: string; category: FactCategory; title: string; organization: string | null
  date_start: string | null; date_end: string | null; claim_text: string; tools: string[]; metrics: string[]
  source_citation: string; confidence: string; confirmed: boolean; created_at: string
}
export const hydrateFact = (r: any): Fact => ({ ...r, tools: safeParse(r.tools_json, []), metrics: safeParse(r.metrics_json, []), confirmed: !!r.confirmed })

export type FactInput = Partial<Omit<Fact, 'fact_id' | 'profile_id' | 'created_at'>> & { category: FactCategory; title: string }

export function addFact(db: DB, profileId: string, f: FactInput): string {
  const fact_id = id('f')
  run(db, `INSERT INTO facts (fact_id, profile_id, category, title, organization, date_start, date_end, claim_text, tools_json, metrics_json, source_citation, confidence, confirmed, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, fact_id, profileId, f.category, f.title, f.organization ?? null, f.date_start ?? null, f.date_end ?? null,
    f.claim_text ?? '', JSON.stringify(f.tools ?? []), JSON.stringify(f.metrics ?? []), f.source_citation ?? 'manual', f.confidence ?? 'high', f.confirmed ? 1 : 0, nowIso())
  return fact_id
}
export const listFacts = (db: DB, profileId: string, onlyConfirmed = false) =>
  all(db, `SELECT * FROM facts WHERE profile_id = ? ${onlyConfirmed ? 'AND confirmed = 1' : ''} ORDER BY category, created_at`, profileId).map(hydrateFact)

export function updateFact(db: DB, profileId: string, factId: string, f: Partial<FactInput>) {
  const cur = get(db, 'SELECT * FROM facts WHERE fact_id=? AND profile_id=?', factId, profileId)
  if (!cur) throw new Error('Fact not found in this profile')
  const c = hydrateFact(cur)
  const n = { ...c, ...f }
  run(db, `UPDATE facts SET category=?, title=?, organization=?, date_start=?, date_end=?, claim_text=?, tools_json=?, metrics_json=?, confirmed=? WHERE fact_id=? AND profile_id=?`,
    n.category, n.title, n.organization ?? null, n.date_start ?? null, n.date_end ?? null, n.claim_text ?? '', JSON.stringify(n.tools ?? []), JSON.stringify(n.metrics ?? []), n.confirmed ? 1 : 0, factId, profileId)
}
export const deleteFact = (db: DB, profileId: string, factId: string) => run(db, 'DELETE FROM facts WHERE fact_id=? AND profile_id=?', factId, profileId)
export const confirmAllFacts = (db: DB, profileId: string) => run(db, 'UPDATE facts SET confirmed=1 WHERE profile_id=?', profileId)
