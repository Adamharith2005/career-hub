import { DB, all, get, run, id, nowIso, tx } from './db.ts'
import { APP_STATUSES, POST_APPLY, PRE_APPLY, TERMINAL, STATUS_LABEL, safeParse, type AppStatus } from './domain.ts'

export interface NewApplication {
  companyId?: string | null; companyName: string; roleTitle: string; roleFamily?: string; careerType?: 'INTERNSHIP' | 'GRADUATE'
  mode?: 'ADVERTISED_VACANCY' | 'SPECULATIVE_OUTREACH'; location?: string | null; source?: string | null; jobUrl?: string | null; jobText?: string
  spec?: unknown; assessment?: unknown; compensation?: unknown; contactEmail?: string | null; folderPath?: string | null
}

export function addEvent(db: DB, profileId: string, appId: string, type: string, summary: string, o: { from?: string | null; to?: string | null; meta?: unknown; at?: string } = {}) {
  run(db, `INSERT INTO application_events (event_id, profile_id, application_id, event_type, from_status, to_status, summary, metadata_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    id('ev'), profileId, appId, type, o.from ?? null, o.to ?? null, summary, o.meta ? JSON.stringify(o.meta) : null, o.at ?? nowIso())
}

export function createApplication(db: DB, profileId: string, a: NewApplication): string {
  if (!a.companyName.trim() || !a.roleTitle.trim()) throw new Error('Company and role title are required.')
  const app_id = id('app')
  const t = nowIso()
  tx(db, () => {
    run(db, `INSERT INTO applications (application_id, profile_id, company_id, company_name, role_title, role_family, career_type, mode, status, location, source, job_url, job_text,
             job_spec_json, assessment_json, compensation_json, contact_email, folder_path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'SAVED',?,?,?,?,?,?,?,?,?,?,?)`,
      app_id, profileId, a.companyId ?? null, a.companyName.trim(), a.roleTitle.trim(), a.roleFamily ?? 'swe', a.careerType ?? 'INTERNSHIP', a.mode ?? 'ADVERTISED_VACANCY',
      a.location ?? null, a.source ?? null, a.jobUrl ?? null, a.jobText ?? '', a.spec ? JSON.stringify(a.spec) : null, a.assessment ? JSON.stringify(a.assessment) : null,
      a.compensation ? JSON.stringify(a.compensation) : null, a.contactEmail ?? null, a.folderPath ?? null, t, t)
    addEvent(db, profileId, app_id, 'CREATED', `Saved ${a.roleTitle} at ${a.companyName}`, { to: 'SAVED' })
  })
  return app_id
}

export function hydrateApp(r: any) {
  return { ...r, spec: safeParse<any>(r.job_spec_json, null), assessment: safeParse<any>(r.assessment_json, null), compensation: safeParse<any>(r.compensation_json, null) }
}

export function getApp(db: DB, profileId: string, appId: string) {
  const r = get(db, 'SELECT * FROM applications WHERE application_id=? AND profile_id=?', appId, profileId)
  if (!r) throw new Error('Application not found in this profile.')
  return hydrateApp(r)
}

export function canTransition(from: AppStatus, to: AppStatus, hasApplied: boolean): { ok: boolean; reason?: string } {
  if (from === to) return { ok: false, reason: 'Already in this status.' }
  if (to === 'APPLIED') return { ok: false, reason: 'Use "Mark as applied" and confirm the date and method. Generating documents never submits an application.' }
  if (PRE_APPLY.includes(to) && hasApplied) return { ok: false, reason: 'This application was already submitted; it cannot go back to a draft status.' }
  if (POST_APPLY.includes(to) && !hasApplied) return { ok: false, reason: `Mark the application as applied first — it cannot be "${STATUS_LABEL[to]}" before submission.` }
  if (to === 'ACCEPTED' && from !== 'OFFER') return { ok: false, reason: 'Only an offer can be accepted.' }
  if (to === 'REJECTED' && !hasApplied) return { ok: false, reason: 'Use "Not pursued" for something you never submitted.' }
  return { ok: true }
}

export function setStatus(db: DB, profileId: string, appId: string, to: AppStatus, note?: string) {
  if (!APP_STATUSES.includes(to)) throw new Error('Unknown status')
  const a = getApp(db, profileId, appId)
  const c = canTransition(a.status, to, !!a.applied_at)
  if (!c.ok) throw new Error(c.reason)
  tx(db, () => {
    run(db, 'UPDATE applications SET status=?, updated_at=? WHERE application_id=? AND profile_id=?', to, nowIso(), appId, profileId)
    addEvent(db, profileId, appId, 'STATUS', note?.trim() || `${STATUS_LABEL[a.status as AppStatus]} → ${STATUS_LABEL[to]}`, { from: a.status, to })
    if (TERMINAL.includes(to)) run(db, 'UPDATE applications SET next_action_text=NULL, next_action_due=NULL WHERE application_id=?', appId)
  })
}

export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from); let left = n
  while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left-- }
  return d
}

/** The ONLY path to APPLIED. Requires explicit confirmation plus date and method. */
export function markApplied(db: DB, profileId: string, appId: string, o: { confirmed: boolean; date: string; method: string; note?: string; followUpDays?: number }) {
  if (o.confirmed !== true) throw new Error('Please confirm that you actually submitted this application.')
  if (!o.date || isNaN(new Date(o.date).getTime())) throw new Error('Enter the date you applied.')
  if (new Date(o.date).getTime() > Date.now() + 86400000) throw new Error('The applied date cannot be in the future.')
  if (!o.method?.trim()) throw new Error('Choose how you applied.')
  const a = getApp(db, profileId, appId)
  if (a.applied_at) throw new Error('This application is already marked as applied.')
  if (TERMINAL.includes(a.status)) throw new Error('This application is closed.')
  const days = o.followUpDays ?? 7
  const due = addBusinessDays(new Date(o.date), days).toISOString().slice(0, 10)
  tx(db, () => {
    run(db, `UPDATE applications SET status='APPLIED', applied_at=?, applied_method=?, next_action_text=?, next_action_due=?, updated_at=? WHERE application_id=? AND profile_id=?`,
      new Date(o.date).toISOString(), o.method.trim(), 'Follow up if you have not heard back', due, nowIso(), appId, profileId)
    addEvent(db, profileId, appId, 'APPLIED', `Applied via ${o.method.trim()}${o.note ? ` — ${o.note}` : ''}`, { from: a.status, to: 'APPLIED', meta: { method: o.method, date: o.date }, at: new Date(o.date).toISOString() })
    run(db, `UPDATE document_versions SET is_submitted_version=1 WHERE doc_id IN (
      SELECT doc_id FROM document_versions d WHERE application_id=? AND profile_id=? AND version_number=(SELECT MAX(version_number) FROM document_versions WHERE application_id=d.application_id AND doc_type=d.doc_type))`, appId, profileId)
  })
}

export function recordResponse(db: DB, profileId: string, appId: string, summary: string) {
  const a = getApp(db, profileId, appId)
  if (!a.applied_at) throw new Error('Mark the application as applied before recording an employer response.')
  addEvent(db, profileId, appId, 'RESPONSE', summary.trim() || 'Employer responded')
}

export function addNote(db: DB, profileId: string, appId: string, text: string) {
  getApp(db, profileId, appId)
  if (!text.trim()) return
  addEvent(db, profileId, appId, 'NOTE', text.trim())
}

export function scheduleFollowUp(db: DB, profileId: string, appId: string, o: { dueDate: string | null; text?: string }) {
  getApp(db, profileId, appId)
  if (o.dueDate === null) {
    run(db, 'UPDATE applications SET next_action_text=NULL, next_action_due=NULL, updated_at=? WHERE application_id=?', nowIso(), appId)
    addEvent(db, profileId, appId, 'FOLLOWUP_DISMISSED', 'Dismissed the follow-up reminder')
  } else {
    run(db, 'UPDATE applications SET next_action_text=?, next_action_due=?, updated_at=? WHERE application_id=?', o.text?.trim() || 'Follow up', o.dueDate, nowIso(), appId)
    addEvent(db, profileId, appId, 'FOLLOWUP_SET', `Follow-up set for ${o.dueDate}${o.text ? `: ${o.text}` : ''}`)
  }
}

export function updateApp(db: DB, profileId: string, appId: string, p: Partial<{ company_name: string; role_title: string; role_family: string; career_type: string; location: string | null; source: string | null; job_url: string | null; job_text: string; contact_email: string | null; notes: string; compensation: unknown; assessment: unknown; spec: unknown; folder_path: string | null }>) {
  const a = getApp(db, profileId, appId)
  const m = { ...a, ...p }
  run(db, `UPDATE applications SET company_name=?, role_title=?, role_family=?, career_type=?, location=?, source=?, job_url=?, job_text=?, contact_email=?, notes=?, compensation_json=?, assessment_json=?, job_spec_json=?, folder_path=?, updated_at=? WHERE application_id=? AND profile_id=?`,
    m.company_name, m.role_title, m.role_family, m.career_type, m.location ?? null, m.source ?? null, m.job_url ?? null, m.job_text ?? '', m.contact_email ?? null, m.notes ?? '',
    p.compensation !== undefined ? JSON.stringify(p.compensation) : a.compensation_json, p.assessment !== undefined ? JSON.stringify(p.assessment) : a.assessment_json,
    p.spec !== undefined ? JSON.stringify(p.spec) : a.job_spec_json, m.folder_path ?? null, nowIso(), appId, profileId)
}

export const listEvents = (db: DB, profileId: string, appId: string) =>
  all(db, 'SELECT * FROM application_events WHERE application_id=? AND profile_id=? ORDER BY created_at DESC, rowid DESC', appId, profileId)
    .map((e: any) => ({ ...e, meta: safeParse(e.metadata_json, null) }))

export type Readiness = 'NOT_STARTED' | 'RESUME_ONLY' | 'READY' | 'NEEDS_FIXES'
export function readiness(db: DB, profileId: string, appId: string): Readiness {
  const latest = (t: string) => get<any>(db, `SELECT qa_passed FROM document_versions WHERE application_id=? AND profile_id=? AND doc_type=? ORDER BY version_number DESC LIMIT 1`, appId, profileId, t)
  const r = latest('RESUME'), l = latest('COVER_LETTER')
  if (!r && !l) return 'NOT_STARTED'
  if ((r && !r.qa_passed) || (l && !l.qa_passed)) return 'NEEDS_FIXES'
  return r && l ? 'READY' : 'RESUME_ONLY'
}

export function listApplications(db: DB, profileId: string, f: { q?: string; filter?: string } = {}) {
  const rows = all(db, 'SELECT * FROM applications WHERE profile_id=? ORDER BY updated_at DESC', profileId).map(hydrateApp)
  const q = f.q?.trim().toLowerCase()
  const groups: Record<string, (s: string, applied: boolean) => boolean> = {
    TO_APPLY: (s) => PRE_APPLY.includes(s as AppStatus),
    ACTIVE: (s, ap) => ap && !TERMINAL.includes(s as AppStatus),
    INTERVIEW: (s) => ['SCREENING', 'ASSESSMENT', 'INTERVIEW'].includes(s),
    OFFER: (s) => ['OFFER', 'ACCEPTED'].includes(s),
    CLOSED: (s) => TERMINAL.includes(s as AppStatus),
  }
  return rows.filter((a) => (!q || `${a.company_name} ${a.role_title}`.toLowerCase().includes(q)) && (!f.filter || f.filter === 'ALL' || groups[f.filter]?.(a.status, !!a.applied_at)))
    .map((a) => ({
      application_id: a.application_id, company_name: a.company_name, role_title: a.role_title, status: a.status, mode: a.mode, career_type: a.career_type, location: a.location,
      fit_score: a.assessment?.score ?? null, recommendation: a.assessment?.recommendation ?? null, confidence: a.assessment?.confidence ?? null, applied_at: a.applied_at,
      next_action_text: a.next_action_text, next_action_due: a.next_action_due, created_at: a.created_at, updated_at: a.updated_at, readiness: readiness(db, profileId, a.application_id),
    }))
}

export function metrics(db: DB, profileId: string, now = new Date()) {
  const apps = all<any>(db, 'SELECT application_id, status, applied_at, next_action_due FROM applications WHERE profile_id=?', profileId)
  const submitted = apps.filter((a) => a.applied_at)
  const responded = new Set(all<any>(db, `SELECT DISTINCT application_id FROM application_events WHERE profile_id=? AND (event_type='RESPONSE' OR (event_type='STATUS' AND to_status IN ('SCREENING','ASSESSMENT','INTERVIEW','OFFER','ACCEPTED','REJECTED')))`, profileId).map((r) => r.application_id))
  const today = now.toISOString().slice(0, 10)
  const due = apps.filter((a) => a.next_action_due && a.next_action_due <= today && !TERMINAL.includes(a.status))
  const respondedSubmitted = submitted.filter((a) => responded.has(a.application_id)).length
  return {
    submitted: submitted.length,
    active: submitted.filter((a) => !TERMINAL.includes(a.status)).length,
    interviewing: apps.filter((a) => ['SCREENING', 'ASSESSMENT', 'INTERVIEW'].includes(a.status) && a.applied_at).length,
    offers: apps.filter((a) => a.status === 'OFFER' || a.status === 'ACCEPTED').length,
    drafts: apps.filter((a) => !a.applied_at && PRE_APPLY.includes(a.status)).length,
    responseRate: submitted.length ? respondedSubmitted / submitted.length : null,
    followUpsDue: due.length,
    total: apps.length,
  }
}

export function nextUp(db: DB, profileId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  return all<any>(db, `SELECT application_id, company_name, role_title, next_action_text, next_action_due FROM applications WHERE profile_id=? AND next_action_due IS NOT NULL AND status NOT IN ('ACCEPTED','REJECTED','WITHDRAWN','NOT_PURSUED') ORDER BY next_action_due ASC LIMIT 5`, profileId)
    .map((r) => ({ ...r, overdue: r.next_action_due < today }))
}
