import fs from 'node:fs'
import path from 'node:path'
import { DB, all, get, run, id, nowIso } from './db.ts'
import * as P from './profiles.ts'
import * as C from './companies.ts'
import * as A from './applications.ts'
import { importCv, listSourceDocs } from './cv.ts'
import { parseJobText, compensationFor, type JobSpec } from './job.ts'
import { assess } from './fit.ts'
import { buildResume, buildLetter, factCheckResume, factCheckLetter, diffVsMaster, type ResumeAST, type LetterAST, type ChangeLogEntry } from './resume.ts'
import { renderResumePdf, renderLetterPdf, renderResumeDocx, renderLetterDocx, qaExport, type QaReport } from './render.ts'
import { buildEmail, buildEml, lintEmail, setAttachmentLine, EMAIL_KIND_LABEL, type EmailKind } from './email.ts'
import { aiAnalyzeJob, aiWriteLetter, aiWriteEmailBody, AiError, describeProvider, DEFAULT_MODELS, type AiConfig } from './ai.ts'
import { fetchJobPage, FetchBlocked } from './fetchjob.ts'
import { applicationDir, checkFile, ensureDir, profileDir, sha256, sha256File, writeFileAtomic, writeNewFile, assertInside } from './storage.ts'
import { ROLE_FAMILIES, roleLabel, slugify, safeParse, STATUS_LABEL, APP_STATUSES, type AppStatus } from './domain.ts'

export interface Env {
  db: DB
  userDataDir: string
  seedFile: string
  secrets: { get(profileId: string): string | null; set(profileId: string, value: string | null): void; available(): boolean }
  ui: {
    pickFolder(): Promise<string | null>
    pickFile(kind: 'cv' | 'company'): Promise<string | null>
    openPath(p: string): Promise<string>
    showItem(p: string): void
    openExternal(u: string): void
    documentsPath(): string
  }
  fetchImpl?: typeof fetch
  now?: () => Date
}

export class ApiError extends Error {
  constructor(message: string, public code = 'ERROR', public detail?: unknown) { super(message) }
}

export function createApi(env: Env) {
  const { db } = env
  const now = () => env.now?.() ?? new Date()
  const fetchImpl = () => env.fetchImpl ?? fetch

  const activeId = () => { const i = P.getActiveProfileId(db); if (!i) throw new ApiError('Create a profile first.', 'NO_PROFILE'); return i }
  const profile = () => P.getProfile(db, activeId())!
  const root = (p = profile()) => { if (!p.storage_root) throw new ApiError('Choose where to save your applications first (Settings → Storage).', 'NO_FOLDER'); return p.storage_root as string }
  const masterDir = (p = profile()) => path.join(env.userDataDir, 'profiles', `${slugify(p.name, 30)}__${p.profile_id}`, 'originals')

  function syncMaster(p = profile()) {
    if (!p.storage_root) return
    const m = path.join(profileDir(p.storage_root, p), 'Master')
    ensureDir(p.storage_root, path.join(m, 'originals'))
    for (const d of listSourceDocs(db, p.profile_id) as any[]) {
      const dest = path.join(m, 'originals', path.basename(d.stored_path))
      if (!fs.existsSync(dest) && fs.existsSync(d.stored_path)) fs.copyFileSync(d.stored_path, dest)
    }
    writeFileAtomic(p.storage_root, path.join(m, 'fact-bank.json'), JSON.stringify({ exportedAt: nowIso(), profile: { name: p.name, identity: p.identity, roles: p.roles }, facts: P.listFacts(db, p.profile_id) }, null, 2))
  }

  function aiConfig(pid = activeId()): { cfg: AiConfig | null; host?: string; consented: boolean; local: boolean } {
    const provider = P.getSetting(db, pid, 'ai.provider') as AiConfig['provider'] | ''
    if (!provider) return { cfg: null, consented: false, local: false }
    const cfg: AiConfig = { provider, model: P.getSetting(db, pid, 'ai.model') || DEFAULT_MODELS[provider], baseUrl: P.getSetting(db, pid, 'ai.baseUrl') || undefined, apiKey: env.secrets.get(pid) ?? undefined, redact: P.getSetting(db, pid, 'ai.redact') === '1' }
    const d = describeProvider(cfg)
    return { cfg, host: d.host, local: d.isLocal, consented: P.getSetting(db, pid, 'ai.consent') === d.host }
  }

  const companyCtx = (pid: string, companyId?: string | null) => companyId ? C.getCompany(db, pid, companyId) : null

  function computeAssessment(p: ReturnType<typeof profile>, spec: JobSpec, jobText: string, company: any, careerType: 'INTERNSHIP' | 'GRADUATE') {
    return assess({ profile: p, facts: P.listFacts(db, p.profile_id), spec, jobText, company, careerType, now: now() })
  }

  function usableEmail(c: any): string | null {
    const e = (c?.hr_email as string | null)?.trim()
    if (e && /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(e)) return e
    const g = (c?.general_contact as string | null)?.trim()
    return g && /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(g) ? g : null
  }

  // ---------------------------------------------------------------- documents
  function nextVersion(pid: string, appId: string, type: string) {
    return (get<any>(db, 'SELECT MAX(version_number) m FROM document_versions WHERE application_id=? AND profile_id=? AND doc_type=?', appId, pid, type)?.m ?? 0) + 1
  }
  const vv = (n: number) => String(n).padStart(2, '0')

  async function exportDoc(app: any, type: 'RESUME' | 'COVER_LETTER', ast: ResumeAST | LetterAST, changelog: ChangeLogEntry[], factCheck: unknown) {
    const p = profile(); const r = root(p)
    const dir = ensureDir(r, applicationDir(r, p, app))
    const v = nextVersion(p.profile_id, app.application_id, type)
    const base = `${type === 'RESUME' ? 'Resume' : 'CoverLetter'}_${slugify(p.identity.fullName || p.name, 24)}_${slugify(app.company_name, 24)}_v${vv(v)}`
    const isR = type === 'RESUME'
    const pdf = isR ? await renderResumePdf(ast as ResumeAST, { targetPages: app.career_type === 'INTERNSHIP' ? 1 : 2 }) : await renderLetterPdf(ast as LetterAST)
    const docx = isR ? await renderResumeDocx(ast as ResumeAST) : await renderLetterDocx(ast as LetterAST)
    const pdfF = writeNewFile(r, path.join(dir, `${base}.pdf`), pdf.buffer)
    const docxF = writeNewFile(r, path.join(dir, `${base}.docx`), docx)
    const facts = P.listFacts(db, p.profile_id, true)
    let qa: QaReport
    const own = facts.map((f) => `${f.title} ${f.organization ?? ''} ${f.claim_text}`).join(' ')
    if (isR) {
      const a = ast as ResumeAST
      qa = await qaExport({ kind: 'resume', pdf: pdf.buffer, docx, pages: pdf.pages, fontSize: pdf.fontSize, maxPages: app.career_type === 'INTERNSHIP' ? 1 : 2, name: a.header.name, email: p.identity.email,
        headings: a.sections.map((s) => s.title), expectedLinks: a.header.contacts.filter((c) => c.url && !c.url.startsWith('mailto:')).map((c) => c.url!),
        fingerprints: a.sections.flatMap((s) => (s.items ?? []).flatMap((i) => i.bullets.map((b) => b.text)).concat((s.skillGroups ?? []).map((g) => g.values[0]))), targetCompany: app.company_name, allCompanyNames: C.allCompanyNames(db, p.profile_id), ownText: own })
    } else {
      const a = ast as LetterAST
      qa = await qaExport({ kind: 'letter', pdf: pdf.buffer, docx, pages: pdf.pages, fontSize: pdf.fontSize, maxPages: 1, name: a.sender.name, email: p.identity.email, headings: [], expectedLinks: [],
        fingerprints: a.paragraphs.map((x) => x.text), targetCompany: app.company_name, allCompanyNames: C.allCompanyNames(db, p.profile_id), ownText: own })
    }
    const doc_id = id('dv')
    run(db, `INSERT INTO document_versions (doc_id, profile_id, application_id, doc_type, version_number, ast_json, changelog_json, qa_passed, qa_report_json, fact_check_json,
             pdf_path, pdf_sha256, pdf_size, docx_path, docx_sha256, docx_size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      doc_id, p.profile_id, app.application_id, type, v, JSON.stringify(ast), JSON.stringify(changelog), qa.passed ? 1 : 0, JSON.stringify(qa), JSON.stringify(factCheck), pdfF.path, pdfF.sha256, pdfF.size, docxF.path, docxF.sha256, docxF.size, nowIso())
    return { doc_id, version: v, qa, pdf: pdfF, docx: docxF }
  }

  function hydrateDoc(d: any) {
    return { ...d, ast: safeParse(d.ast_json, null), changelog: safeParse(d.changelog_json, []), qa: safeParse<QaReport | null>(d.qa_report_json, null), factCheck: safeParse(d.fact_check_json, null),
      pdfState: checkFile(d.pdf_path, d.pdf_sha256), docxState: checkFile(d.docx_path, d.docx_sha256) }
  }
  const listDocs = (pid: string, appId: string) => all(db, 'SELECT * FROM document_versions WHERE application_id=? AND profile_id=? ORDER BY doc_type, version_number DESC', appId, pid).map(hydrateDoc)

  function writeSupportFiles(app: any, spec: any) {
    const p = profile(); const r = root(p)
    const dir = ensureDir(r, applicationDir(r, p, app))
    writeFileAtomic(r, path.join(dir, 'job-description.txt'), app.job_text || '(no job text — speculative enquiry or manual entry)')
    writeFileAtomic(r, path.join(dir, 'assessment.json'), JSON.stringify({ spec, assessment: app.assessment, compensation: app.compensation }, null, 2))
    if (!fs.existsSync(path.join(dir, 'notes.md'))) writeFileAtomic(r, path.join(dir, 'notes.md'), `# ${app.company_name} — ${app.role_title}\n\n${app.notes || ''}\n`)
    run(db, 'UPDATE applications SET folder_path=? WHERE application_id=?', dir, app.application_id)
    return dir
  }

  // ---------------------------------------------------------------- handlers
  const h = {
    // ---- boot / profiles
    'boot': async () => {
      const profiles = P.listProfiles(db).map((x) => ({ profile_id: x.profile_id, name: x.name, onboarding_done: !!x.onboarding_done }))
      const aid = P.getActiveProfileId(db); const active = aid
      return { profiles, activeProfileId: aid, profile: aid ? P.getProfile(db, aid) : null, roleFamilies: ROLE_FAMILIES, statuses: APP_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s] })), companyCount: get<any>(db, 'SELECT COUNT(*) n FROM companies WHERE profile_id IS NULL')!.n, secureKeyStorage: env.secrets.available(), defaultFolder: path.join(env.ui.documentsPath(), 'Career Hub'), dataDir: env.userDataDir, followupDays: Number(active ? P.getSetting(db, active, 'followup.days', '7') : 7) || 7 }
    },
    'settings.set': async (a: { followupDays?: number }) => { if (a.followupDays) P.setSetting(db, activeId(), 'followup.days', String(Math.min(30, Math.max(1, Math.round(a.followupDays))))); return true },
    'profile.create': async (a: { name: string }) => { const p = P.createProfile(db, a.name); P.setActiveProfile(db, p.profile_id); return p },
    'profile.switch': async (a: { id: string }) => { P.setActiveProfile(db, a.id); return P.getProfile(db, a.id) },
    'profile.update': async (a: any) => { const p = P.updateProfile(db, activeId(), a); if (p.storage_root) syncMaster(p); return p },
    'profile.delete': async (a: { id: string }) => { P.deleteProfile(db, a.id); return true },

    // ---- storage
    'folder.choose': async () => env.ui.pickFolder(),
    'folder.set': async (a: { path: string }) => {
      let target = path.resolve(a.path)
      if (path.basename(target).toLowerCase() !== 'career hub') target = path.join(target, 'Career Hub')
      fs.mkdirSync(target, { recursive: true })
      fs.mkdirSync(path.join(target, 'Company-Data'), { recursive: true })
      const seedDest = path.join(target, 'Company-Data', 'cyberjaya-seed-source.tsv')
      if (!fs.existsSync(seedDest) && fs.existsSync(env.seedFile)) fs.copyFileSync(env.seedFile, seedDest)
      const p = P.updateProfile(db, activeId(), { storage_root: target })
      ensureDir(target, profileDir(target, p)); syncMaster(p)
      return { root: target, profileDir: profileDir(target, p) }
    },
    'fs.openRoot': async () => { const r = root(); return env.ui.openPath(profileDir(r, profile())) },
    'fs.openAppFolder': async (a: { appId: string }) => {
      const app = A.getApp(db, activeId(), a.appId); const r = root()
      const dir = ensureDir(r, applicationDir(r, profile(), app)); return env.ui.openPath(dir)
    },
    'fs.reveal': async (a: { path: string }) => { assertInside(root(), a.path); env.ui.showItem(a.path); return true },

    // ---- CV & facts
    'cv.pick': async () => env.ui.pickFile('cv'),
    'cv.import': async (a: { path: string; kind?: 'MASTER_CV' | 'RESUME' | 'SUPPORT' }) => {
      const p = profile()
      const r = await importCv(db, p.profile_id, a.path, masterDir(p), a.kind ?? 'MASTER_CV')
      const idn = r.identity, cur = p.identity
      const patch: any = {}
      for (const k of Object.keys(idn) as (keyof typeof idn)[]) if (idn[k] && !cur[k] || (k === 'fullName' && idn[k] && cur.fullName === p.name)) patch[k] = idn[k]
      if (Object.keys(patch).length) P.updateProfile(db, p.profile_id, { identity: patch })
      syncMaster()
      return { ...r, facts: P.listFacts(db, p.profile_id), identity: P.getProfile(db, p.profile_id)!.identity }
    },
    'cv.docs': async () => listSourceDocs(db, activeId()),
    'facts.list': async () => P.listFacts(db, activeId()),
    'facts.save': async (a: any) => {
      const pid = activeId()
      if (a.fact_id) P.updateFact(db, pid, a.fact_id, { ...a, tools: a.tools ?? [] }); else a.fact_id = P.addFact(db, pid, { ...a, source_citation: 'manual', confidence: 'high', confirmed: a.confirmed ?? true })
      syncMaster(); return a.fact_id as string
    },
    'facts.delete': async (a: { id: string }) => { P.deleteFact(db, activeId(), a.id); syncMaster(); return true },
    'facts.confirm': async (a: { ids?: string[] }) => {
      const pid = activeId()
      if (a.ids) for (const i of a.ids) P.updateFact(db, pid, i, { confirmed: true }); else P.confirmAllFacts(db, pid)
      syncMaster(); return true
    },

    // ---- companies
    'companies.list': async (a: C.CompanyFilter) => C.listCompanies(db, activeId(), a ?? {}),
    'companies.get': async (a: { id: string }) => C.getCompany(db, activeId(), a.id),
    'companies.add': async (a: any) => C.addUserCompany(db, activeId(), a),
    'companies.note': async (a: { id: string; note: string }) => { C.setCompanyNote(db, activeId(), a.id, a.note); return true },
    'companies.importPick': async () => { const f = await env.ui.pickFile('company'); return f ? C.importCompanyFile(db, f) : null },
    'companies.import': async (a: { path: string }) => C.importCompanyFile(db, a.path),
    'link.open': async (a: { url: string }) => { if (!/^https?:\/\//i.test(a.url)) throw new ApiError('Only web links can be opened.'); env.ui.openExternal(a.url); return true },

    // ---- AI settings
    'ai.get': async () => {
      const pid = activeId(); const c = aiConfig(pid)
      return { provider: c.cfg?.provider ?? '', model: c.cfg?.model ?? '', baseUrl: c.cfg?.baseUrl ?? '', redact: c.cfg?.redact ?? false, host: c.host ?? null, local: c.local, consented: c.consented, hasKey: !!env.secrets.get(pid), secureStorage: env.secrets.available(), defaults: DEFAULT_MODELS }
    },
    'ai.set': async (a: { provider: string; model?: string; baseUrl?: string; apiKey?: string | null; redact?: boolean; consent?: boolean }) => {
      const pid = activeId()
      if (!a.provider) { P.setSetting(db, pid, 'ai.provider', ''); P.setSetting(db, pid, 'ai.consent', ''); env.secrets.set(pid, null); return h['ai.get']() }
      if (a.baseUrl) { try { const u = new URL(a.baseUrl); if (u.protocol !== 'https:' && !/^(localhost|127\.)/.test(u.hostname)) throw new Error('x') } catch { throw new ApiError('The endpoint must use https:// (http:// is only allowed for localhost).') } }
      P.setSetting(db, pid, 'ai.provider', a.provider); P.setSetting(db, pid, 'ai.model', a.model ?? ''); P.setSetting(db, pid, 'ai.baseUrl', a.baseUrl ?? ''); P.setSetting(db, pid, 'ai.redact', a.redact ? '1' : '0')
      if (a.apiKey !== undefined && a.apiKey !== '') env.secrets.set(pid, a.apiKey)
      const c = aiConfig(pid)
      P.setSetting(db, pid, 'ai.consent', a.consent && c.host ? c.host : (c.consented ? c.host! : ''))
      return h['ai.get']()
    },
    'ai.test': async () => {
      const c = aiConfig(); if (!c.cfg) throw new ApiError('AI is not configured.', 'NOT_CONFIGURED'); if (!c.consented) throw new ApiError('Consent is required before contacting the AI provider.', 'CONSENT_REQUIRED')
      try { await aiAnalyzeJob(c.cfg, 'Software Engineer Intern at Example. Requirements: Python, SQL.', parseJobText('x'), fetchImpl()); return { ok: true } }
      catch (e: any) { if (e instanceof AiError) throw new ApiError(e.message, e.code); throw e }
    },

    // ---- job intake
    'job.fetchUrl': async (a: { url: string }) => {
      try { return await fetchJobPage(a.url, { fetchImpl: env.fetchImpl }) } catch (e: any) { if (e instanceof FetchBlocked) throw new ApiError(e.message, e.code); throw e }
    },
    'job.analyze': async (a: { text: string; companyId?: string | null; company?: string; title?: string; careerType?: 'INTERNSHIP' | 'GRADUATE'; useAi?: boolean }) => {
      const p = profile(); const company = companyCtx(p.profile_id, a.companyId)
      const text = a.text.trim()
      if (text.length < 40) throw new ApiError('Paste the full job description (at least a few lines).', 'TOO_SHORT')
      let spec = parseJobText(text, { company: a.company || company?.name, title: a.title })
      let ai: { status: 'used' | 'skipped' | 'not_configured' | 'consent_required' | 'error'; message?: string } = { status: 'not_configured' }
      const c = aiConfig(p.profile_id)
      if (a.useAi !== false && c.cfg) {
        if (!c.consented) ai = { status: 'consent_required', message: `Allow sending the job text to ${c.host} in Settings → AI to use AI analysis.` }
        else { try { spec = await aiAnalyzeJob(c.cfg, text, spec, fetchImpl()); ai = { status: 'used' } } catch (e: any) { ai = { status: 'error', message: e.message } } }
      }
      const careerType = a.careerType ?? (spec.level === 'GRADUATE' ? 'GRADUATE' : (p.career_types[0] === 'GRADUATE' && !p.career_types.includes('INTERNSHIP') ? 'GRADUATE' : 'INTERNSHIP'))
      const assessment = computeAssessment(p, spec, text, company, careerType)
      const compensation = compensationFor(spec, company?.ownership_type, careerType)
      return { spec, assessment, compensation, ai, careerType, contactEmail: usableEmail(company) }
    },

    // ---- applications
    'app.create': async (a: { companyId?: string | null; company: string; title: string; roleFamily?: string; careerType?: 'INTERNSHIP' | 'GRADUATE'; mode?: 'ADVERTISED_VACANCY' | 'SPECULATIVE_OUTREACH'; location?: string; source?: string; jobUrl?: string; jobText?: string; analysis?: { spec: JobSpec; assessment: unknown; compensation: unknown }; contactEmail?: string | null }) => {
      const p = profile()
      const co = companyCtx(p.profile_id, a.companyId)
      const careerType = a.careerType ?? 'INTERNSHIP'
      let spec: JobSpec | null = a.analysis?.spec ?? null
      let assessment: any = a.analysis?.assessment ?? null, compensation: any = a.analysis?.compensation ?? null
      if (!spec && (a.jobText || a.mode === 'SPECULATIVE_OUTREACH')) {
        spec = a.jobText ? parseJobText(a.jobText, { company: a.company, title: a.title }) : { company: a.company, title: a.title, roleFamily: (a.roleFamily ?? p.primary_role ?? 'swe') as any, level: careerType, location: 'Cyberjaya', workMode: null, durationText: null, durationMonthsMin: null, deadline: null, required: [], preferred: [], responsibilities: [], gates: [], pay: null, unknowns: ['Speculative enquiry — no job description'], extraction: 'heuristic', verifiedAt: nowIso() }
      }
      if (spec && !assessment) assessment = computeAssessment(p, spec, a.jobText ?? '', co, careerType)
      if (spec && !compensation) compensation = compensationFor(spec, co?.ownership_type, careerType)
      const appId = A.createApplication(db, p.profile_id, {
        companyId: a.companyId, companyName: a.company, roleTitle: a.title, roleFamily: spec?.roleFamily ?? a.roleFamily ?? p.primary_role ?? 'swe', careerType, mode: a.mode,
        location: a.location ?? spec?.location ?? co?.address?.match(/Cyberjaya/i)?.[0] ?? null, source: a.source ?? (a.jobUrl ? 'Job URL' : a.jobText ? 'Pasted job ad' : co ? 'Cyberjaya directory' : 'Manual'), jobUrl: a.jobUrl, jobText: a.jobText ?? '',
        spec, assessment, compensation, contactEmail: a.contactEmail ?? usableEmail(co),
      })
      if (p.storage_root) { const app = A.getApp(db, p.profile_id, appId); writeSupportFiles(app, spec) }
      return appId
    },
    'app.list': async (a: { q?: string; filter?: string }) => A.listApplications(db, activeId(), a ?? {}),
    'app.get': async (a: { id: string }) => {
      const pid = activeId(); const app = A.getApp(db, pid, a.id)
      return { app, company: companyCtx(pid, app.company_id), events: A.listEvents(db, pid, a.id), docs: listDocs(pid, a.id), emails: all(db, 'SELECT * FROM emails WHERE application_id=? AND profile_id=? ORDER BY created_at DESC', a.id, pid).map((e: any) => ({ ...e, attachments: safeParse(e.attachments_json, []), fileState: checkFile(e.eml_path, e.eml_sha256) })), readiness: A.readiness(db, pid, a.id) }
    },
    'app.update': async (a: { id: string; patch: any }) => { A.updateApp(db, activeId(), a.id, a.patch); return true },
    'app.setStatus': async (a: { id: string; status: AppStatus; note?: string }) => { A.setStatus(db, activeId(), a.id, a.status, a.note); return true },
    'app.markApplied': async (a: { id: string; confirmed: boolean; date: string; method: string; note?: string }) => {
      const pid = activeId(); const days = Number(P.getSetting(db, pid, 'followup.days', '7')) || 7
      A.markApplied(db, pid, a.id, { ...a, followUpDays: days }); return true
    },
    'app.recordResponse': async (a: { id: string; summary: string }) => { A.recordResponse(db, activeId(), a.id, a.summary); return true },
    'app.note': async (a: { id: string; text: string }) => { A.addNote(db, activeId(), a.id, a.text); return true },
    'app.followUp': async (a: { id: string; dueDate: string | null; text?: string }) => { A.scheduleFollowUp(db, activeId(), a.id, a); return true },
    'app.reassess': async (a: { id: string }) => {
      const p = profile(); const app = A.getApp(db, p.profile_id, a.id)
      const spec = app.spec ?? parseJobText(app.job_text, { company: app.company_name, title: app.role_title })
      const assessment = computeAssessment(p, spec, app.job_text, companyCtx(p.profile_id, app.company_id), app.career_type)
      A.updateApp(db, p.profile_id, a.id, { assessment, spec }); return assessment
    },
    'metrics': async () => { const pid = activeId(); return { ...A.metrics(db, pid, now()), nextUp: A.nextUp(db, pid, now()) } },

    // ---- documents
    'docs.generate': async (a: { appId: string; language?: 'en' | 'ms'; useAi?: boolean }) => {
      const p = profile(); const app = A.getApp(db, p.profile_id, a.appId)
      const facts = P.listFacts(db, p.profile_id, true)
      if (!facts.length) throw new ApiError('Confirm at least a few facts in My Profile first — documents are built only from confirmed facts.', 'NO_FACTS')
      root(p)
      const spec: JobSpec = app.spec ?? parseJobText(app.job_text, { company: app.company_name, title: app.role_title })
      const lang = a.language ?? p.prefs.language ?? 'en'
      const rAst = buildResume(p, facts, { ...spec, title: app.role_title, company: app.company_name }, { language: lang, careerType: app.career_type })
      const co = companyCtx(p.profile_id, app.company_id)
      const lAst = buildLetter(p, facts, spec, { company: app.company_name, role: app.role_title, careerType: app.career_type, language: lang, now: now(), recipientLines: undefined })
      if (co?.address && !lAst.recipient.includes(co.address)) lAst.recipient = [lAst.recipient[0], app.company_name]
      let aiNote: { status: string; message?: string; issues?: unknown } = { status: 'not_used' }
      if (a.useAi) {
        const c = aiConfig(p.profile_id)
        if (!c.cfg) aiNote = { status: 'not_configured', message: 'AI is not configured — the template letter was used.' }
        else if (!c.consented) aiNote = { status: 'consent_required', message: `Allow sending your facts to ${c.host} in Settings → AI first.` }
        else {
          try {
            const paras = await aiWriteLetter(c.cfg, { facts, company: app.company_name, role: app.role_title, language: lang, spec, roleFamily: app.role_family }, fetchImpl())
            const draft: LetterAST = { ...lAst, paragraphs: paras.map((t, i) => ({ id: `ai${i}`, text: t, factIds: facts.map((f) => f.fact_id) })) }
            const fc = factCheckLetter(draft, facts)
            if (fc.passed) { lAst.paragraphs = draft.paragraphs; aiNote = { status: 'used' } } else aiNote = { status: 'rejected', message: 'The AI draft was rejected by the fact check, so the template letter was used.', issues: fc.issues }
          } catch (e: any) { aiNote = { status: 'error', message: e.message } }
        }
      }
      const fr = factCheckResume(rAst, facts), fl = factCheckLetter(lAst, facts)
      if (!fr.passed || !fl.passed) return { ok: false as const, issues: [...fr.issues, ...fl.issues], aiNote }
      writeSupportFiles(app, spec)
      const resume = await exportDoc(app, 'RESUME', rAst, rAst.changelog, fr)
      const letter = await exportDoc(app, 'COVER_LETTER', lAst, [], fl)
      if (['SAVED', 'DISCOVERED'].includes(app.status)) A.setStatus(db, p.profile_id, a.appId, 'PREPARING')
      A.addEvent(db, p.profile_id, a.appId, 'DOCS', `Generated resume v${vv(resume.version)} and cover letter v${vv(letter.version)}`)
      if (resume.qa.passed && letter.qa.passed && !A.getApp(db, p.profile_id, a.appId).applied_at && ['PREPARING', 'SAVED'].includes(A.getApp(db, p.profile_id, a.appId).status)) A.setStatus(db, p.profile_id, a.appId, 'READY_TO_APPLY', 'Documents passed all checks')
      return { ok: true as const, resume, letter, aiNote }
    },
    'docs.saveEdit': async (a: { docId: string; ast: ResumeAST | LetterAST }) => {
      const p = profile(); const cur = get<any>(db, 'SELECT * FROM document_versions WHERE doc_id=? AND profile_id=?', a.docId, p.profile_id)
      if (!cur) throw new ApiError('Document not found.')
      const app = A.getApp(db, p.profile_id, cur.application_id); const facts = P.listFacts(db, p.profile_id, true)
      const isR = cur.doc_type === 'RESUME'
      const fc = isR ? factCheckResume(a.ast as ResumeAST, facts) : factCheckLetter(a.ast as LetterAST, facts)
      if (!fc.passed) return { ok: false as const, issues: fc.issues }
      const log: ChangeLogEntry[] = isR ? diffVsMaster(a.ast as ResumeAST).filter((r) => r.status === 'edited').map((r) => ({ kind: 'edited' as const, section: r.section, factId: r.factIds[0], reason: `Edited: ${r.item}` })) : []
      const out = await exportDoc(app, cur.doc_type, a.ast, [...(isR ? (a.ast as ResumeAST).changelog.filter((c) => c.kind !== 'edited') : []), ...log], fc)
      A.addEvent(db, p.profile_id, app.application_id, 'DOCS', `Saved ${isR ? 'resume' : 'cover letter'} v${vv(out.version)} (edited)`)
      return { ok: true as const, ...out }
    },
    'docs.list': async (a: { appId: string }) => listDocs(activeId(), a.appId),
    'docs.pdfBytes': async (a: { docId: string }) => {
      const d = get<any>(db, 'SELECT pdf_path FROM document_versions WHERE doc_id=? AND profile_id=?', a.docId, activeId())
      if (!d || !fs.existsSync(d.pdf_path)) throw new ApiError('The PDF file is missing from disk. Regenerate the documents to recreate it.', 'FILE_MISSING')
      return new Uint8Array(fs.readFileSync(d.pdf_path))
    },
    'docs.diff': async (a: { docId: string }) => {
      const d = get<any>(db, 'SELECT ast_json FROM document_versions WHERE doc_id=? AND profile_id=?', a.docId, activeId())
      return d ? diffVsMaster(JSON.parse(d.ast_json)) : []
    },
    'docs.regenSection': async (a: { appId: string; sectionId: string; ast: ResumeAST }) => {
      const p = profile(); const app = A.getApp(db, p.profile_id, a.appId); const facts = P.listFacts(db, p.profile_id, true)
      const spec: JobSpec = app.spec ?? parseJobText(app.job_text, { company: app.company_name, title: app.role_title })
      const fresh = buildResume(p, facts, { ...spec, title: app.role_title, company: app.company_name }, { language: a.ast.language, careerType: app.career_type })
      const s = fresh.sections.find((x) => x.id === a.sectionId)
      return { ...a.ast, sections: a.ast.sections.map((x) => (x.id === a.sectionId && s ? s : x)) }
    },
    'docs.fileStates': async (a: { appId: string }) => {
      const out: { docId: string; type: string; version: number; pdf: string; docx: string }[] = []
      for (const d of listDocs(activeId(), a.appId)) out.push({ docId: d.doc_id, type: d.doc_type, version: d.version_number, pdf: d.pdfState, docx: d.docxState })
      return out
    },
    'docs.open': async (a: { docId: string; which: 'pdf' | 'docx' }) => {
      const d = get<any>(db, 'SELECT pdf_path, docx_path FROM document_versions WHERE doc_id=? AND profile_id=?', a.docId, activeId())
      const f = a.which === 'pdf' ? d?.pdf_path : d?.docx_path
      if (!f || !fs.existsSync(f)) throw new ApiError('That file is missing from disk. Regenerate the documents to recreate it.', 'FILE_MISSING')
      return env.ui.openPath(f)
    },

    // ---- email
    'email.compose': async (a: { appId: string; kind: EmailKind; language?: 'en' | 'ms'; to?: string; interviewTopic?: string; interviewDate?: string }) => {
      const p = profile(); const app = A.getApp(db, p.profile_id, a.appId); const facts = P.listFacts(db, p.profile_id, true)
      const docs = listDocs(p.profile_id, a.appId)
      const latest = (t: string) => docs.find((d: any) => d.doc_type === t)
      const cands: { key: string; label: string; path: string; name: string; exists: boolean; size: number; checked: boolean }[] = []
      const push = (key: string, label: string, f: string | null | undefined, checked: boolean) => { if (!f) return; const ex = fs.existsSync(f); cands.push({ key, label, path: f, name: path.basename(f), exists: ex, size: ex ? fs.statSync(f).size : 0, checked: checked && ex }) }
      const r = latest('RESUME'), l = latest('COVER_LETTER')
      push('resume', 'resume (PDF)', r?.pdf_path, true)
      push('letter', 'cover letter (PDF)', l?.pdf_path, true)
      const src = (listSourceDocs(db, p.profile_id) as any[])
      src.filter((s) => s.kind !== 'SUPPORT').slice(0, 2).forEach((s, i) => push(`master${i}`, `master CV (${s.original_name})`, s.stored_path, false))
      src.filter((s) => s.kind === 'SUPPORT').forEach((s, i) => push(`support${i}`, s.original_name, s.stored_path, false))
      const labels = cands.filter((c) => c.checked).map((c) => c.label)
      const lang = a.language ?? app.spec?.language ?? p.prefs.language ?? 'en'
      const events = A.listEvents(db, p.profile_id, a.appId)
      const appliedOn = app.applied_at ? new Date(app.applied_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null
      const draft = buildEmail(p, facts, { kind: a.kind, language: lang, company: app.company_name, role: app.role_title, roleFamily: app.role_family, careerType: app.career_type, attachmentLabels: labels,
        appliedOn, hasResponse: events.some((e: any) => e.event_type === 'RESPONSE'), interviewTopic: a.interviewTopic, interviewDate: a.interviewDate, requiredTech: app.spec?.required ?? [] })
      const co = companyCtx(p.profile_id, app.company_id)
      const to = a.to ?? app.contact_email ?? ''
      return { draft, to, toSource: to ? (to === app.contact_email && co && usableEmail(co) === to ? 'Seed research record — verify before sending' : 'Entered by you') : 'No verified address on file. Leave blank and use the official careers page, or enter an address you have confirmed.', attachments: cands, language: lang }
    },
    'email.relabel': async (a: { body: string; labels: string[]; language: 'en' | 'ms' }) => setAttachmentLine(a.body, a.labels, a.language),
    'email.lint': async (a: { appId: string; to: string; subject: string; body: string; attachments: { name: string; path: string }[] }) => {
      const p = profile(); const app = A.getApp(db, p.profile_id, a.appId); const co = companyCtx(p.profile_id, app.company_id)
      return lintEmail({ to: a.to, subject: a.subject, body: a.body, profile: p, company: app.company_name, allCompanyNames: C.allCompanyNames(db, p.profile_id), attachments: a.attachments.map((x) => ({ name: x.name, exists: fs.existsSync(x.path) })), companyWebsite: co?.website, ownText: P.listFacts(db, p.profile_id, true).map((f) => `${f.title} ${f.organization ?? ''} ${f.claim_text}`).join(' ') })
    },
    'email.saveEml': async (a: { appId: string; kind: EmailKind; language: 'en' | 'ms'; to: string; subject: string; body: string; attachmentPaths: string[] }) => {
      const p = profile(); const r = root(p); const app = A.getApp(db, p.profile_id, a.appId); const co = companyCtx(p.profile_id, app.company_id)
      // Only files Career Hub itself knows about may be attached (this profile's exports and uploaded documents) — never arbitrary paths.
      const known = new Set<string>([
        ...all<any>(db, 'SELECT pdf_path, docx_path FROM document_versions WHERE profile_id=?', p.profile_id).flatMap((d) => [d.pdf_path, d.docx_path]),
        ...all<any>(db, 'SELECT stored_path FROM source_documents WHERE profile_id=?', p.profile_id).map((d) => d.stored_path),
      ].filter(Boolean).map((x) => path.resolve(x)))
      const rogue = a.attachmentPaths.find((f) => !known.has(path.resolve(f)))
      if (rogue) throw new ApiError(`"${path.basename(rogue)}" is not one of your Career Hub documents, so it cannot be attached.`, 'ATTACHMENT_NOT_ALLOWED')
      const lint = lintEmail({ to: a.to, subject: a.subject, body: a.body, profile: p, company: app.company_name, allCompanyNames: C.allCompanyNames(db, p.profile_id), attachments: a.attachmentPaths.map((f) => ({ name: path.basename(f), exists: fs.existsSync(f) })), companyWebsite: co?.website, ownText: P.listFacts(db, p.profile_id, true).map((f) => `${f.title} ${f.organization ?? ''} ${f.claim_text}`).join(' ') })
      if (lint.some((i) => i.severity === 'error')) return { ok: false as const, lint }
      const atts = a.attachmentPaths.map((f) => ({ filename: path.basename(f), content: fs.readFileSync(f) }))
      const eml = buildEml({ from: p.identity.email ? `${p.identity.fullName || p.name} <${p.identity.email}>` : undefined, to: a.to, subject: a.subject, body: a.body, attachments: atts, date: now() })
      const dir = ensureDir(r, applicationDir(r, p, app))
      const v = (get<any>(db, 'SELECT MAX(version_number) m FROM emails WHERE application_id=? AND profile_id=?', a.appId, p.profile_id)?.m ?? 0) + 1
      const f = writeNewFile(r, path.join(dir, `email_${a.kind.toLowerCase()}_v${vv(v)}.eml`), eml)
      run(db, `INSERT INTO emails (email_id, profile_id, application_id, kind, language, to_addr, subject, body, attachments_json, eml_path, eml_sha256, version_number, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id('em'), p.profile_id, a.appId, a.kind, a.language, a.to, a.subject, a.body, JSON.stringify(a.attachmentPaths.map((x) => ({ name: path.basename(x), sha256: sha256File(x) }))), f.path, f.sha256, v, nowIso())
      A.addEvent(db, p.profile_id, a.appId, 'EMAIL', `Saved ${EMAIL_KIND_LABEL[a.kind]} draft (.eml) with ${atts.length} attachment(s). Not sent.`)
      return { ok: true as const, path: f.path, sha256: f.sha256, size: f.size, lint }
    },
    'email.openEml': async (a: { path: string }) => { assertInside(root(), a.path); if (!fs.existsSync(a.path)) throw new ApiError('The .eml file is missing from disk.', 'FILE_MISSING'); return env.ui.openPath(a.path) },
    'email.polishAi': async (a: { appId: string; body: string; language: 'en' | 'ms' }) => {
      const p = profile(); const app = A.getApp(db, p.profile_id, a.appId); const facts = P.listFacts(db, p.profile_id, true)
      const c = aiConfig(p.profile_id)
      if (!c.cfg) throw new ApiError('AI is not configured. Add a provider in Settings → AI.', 'NOT_CONFIGURED')
      if (!c.consented) throw new ApiError(`Allow sending your facts to ${c.host} in Settings → AI first.`, 'CONSENT_REQUIRED')
      try {
        const body = await aiWriteEmailBody(c.cfg, { facts, company: app.company_name, role: app.role_title, language: a.language, draft: a.body }, fetchImpl())
        const { factCheckText } = await import('./resume.ts')
        const issues = factCheckText(body, facts, { where: 'Email', allowedStrings: [app.role_title, app.company_name] })
        if (issues.some((i) => i.severity === 'error')) throw new ApiError(`The AI version was rejected by the fact check: ${issues[0].message}`, 'FACT_CHECK')
        return body
      } catch (e: any) { if (e instanceof AiError) throw new ApiError(e.message, e.code); throw e }
    },

    // ---- backup
    'backup.create': async () => {
      const p = profile(); const dir = p.storage_root ? path.join(p.storage_root, 'Backups') : path.join(env.userDataDir, 'backups')
      fs.mkdirSync(dir, { recursive: true })
      const stamp = now().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      const target = path.join(dir, `careerhub-backup-${stamp}.db`)
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
      return { path: target, size: fs.statSync(target).size, note: 'To restore: quit Career Hub, copy this file over careerhub.db in the app data folder, then restart.' }
    },
  }
  type Handlers = typeof h
  async function call(name: string, args?: any) {
    const fn = (h as any)[name]
    if (!fn) throw new ApiError(`Unknown API: ${name}`, 'UNKNOWN')
    return fn(args)
  }
  return { call, h: h as Handlers, helpers: { aiConfig, syncMaster, ensureSeed: async () => { if (get<any>(db, 'SELECT COUNT(*) n FROM companies WHERE profile_id IS NULL')!.n === 0 && fs.existsSync(env.seedFile)) return C.importCompanyFile(db, env.seedFile); return null } } }
}
export type Api = ReturnType<typeof createApi>
