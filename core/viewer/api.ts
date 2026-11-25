/** IPC handler table for the lightweight viewer. No SQLite. Every handler works offline. */
import fs from 'node:fs'
import path from 'node:path'
import { ViewerStore, StoreError, PROFILE_IDS } from './store.ts'
import { catalogFromWorkbook, filterCatalog, reconcileDuplicates, mergeCatalog, readCatalog, writeCatalog, type Catalog, type CatalogFilter, type CatalogCompany } from './catalog.ts'
import { companyDetailsText, contactText, applicationText, allowanceText, allowanceHeadline } from './format.ts'
import { draftEmail, type AttachmentKind } from './email.ts'
import { suitability, defaultRole, companyRoles, ROLE_LABEL, EVIDENCE_ORDER, type RoleFamily, type SortKey } from './suitability.ts'
import { buildMaster, buildTailored, diffCv, unsupportedClaims, evidenceCoverage, fileNameFor } from './cvengine.ts'
import { renderCv } from './cvpdf.ts'
import type { ResumeAST } from '../resume.ts'
import { applyContactResearch, contactSummary, emptyOverrides, missingCsv, missingEmployers, missingFileName, readContactResearch, readOverrides, recipientChoices, withOverrides, writeOverrides, type ContactState } from './contacts.ts'
import { compare, type CompareInput, type Priority } from '../compare.ts'

export class ViewerApiError extends Error { constructor(m: string, public code = 'ERROR') { super(m) } }

export interface ViewerEnv {
  userDataDir: string
  bundledCatalog: string
  seedPaths: string[]
  /** Folder holding the contact research files (the user's Downloads). Fixed by the main process, never by the renderer. */
  researchDir?: string
  /** Where the list of employers still needing contact research is written. */
  exportsDir?: string
  ui: { pickFile(kind: 'doc' | 'workbook'): Promise<string | null>; openPath(p: string): Promise<string>; openExternal(u: string): void; copy(text: string): void }
}

const FAMILY: Record<string, string> = { SOFTWARE: 'swe', FULL_STACK: 'swe', AI_ML: 'ai_ml', DATA_SCIENCE: 'data', ANALYTICS: 'data', CYBERSECURITY: 'cyber', CLOUD: 'cloud_devops', NETWORKING: 'it_support', IT_INFRA: 'it_support', SYSADMIN: 'it_support' }
const toCompare = (c: CatalogCompany): CompareInput => ({
  company_id: c.id, name: c.name, role_families: [...new Set(c.tech.map((t) => FAMILY[t]).filter(Boolean))], tech_departments: c.techDivision,
  allowance_grade: c.allowance.grade, allowance_monthly_min: c.allowance.monthlyMin, internship_evidence: c.internship.evidence, verification_level: c.verificationLevel,
  hr_email: c.contacts.hrEmail, general_contact: c.contacts.generalEmail ?? c.contacts.contactForm ?? c.contacts.phone, careers_page: c.contacts.careersUrl, last_verified: c.lastVerified,
})

export function createViewerApi(env: ViewerEnv) {
  const store = new ViewerStore(env.userDataDir, env.seedPaths)
  const catFile = path.join(env.userDataDir, 'viewer', 'catalog.json')
  const ovFile = path.join(env.userDataDir, 'viewer', 'contact-overrides.json')
  let ov = readOverrides(ovFile)
  let cache: Catalog | null = null
  const emptyCat = (): Catalog => ({ version: 1, generatedAt: '', sourceFile: '', sourceSha256: null, companies: [] })
  /** The company list on disk. A user-applied list keeps working, and gets contact research from the bundled list where it has none. */
  const baseCatalog = (): Catalog => {
    const user = readCatalog(catFile), bundled = readCatalog(env.bundledCatalog)
    if (user && bundled) { const bm = new Map(bundled.companies.map((c) => [c.id, c])); return { ...user, companies: user.companies.map((c) => (!c.contactIntel && bm.get(c.id)?.contactIntel ? { ...c, contactIntel: bm.get(c.id)!.contactIntel } : c)) } }
    return reconcileDuplicates(user ?? bundled ?? emptyCat()).catalog
  }
  let baseCache: Catalog | null = null
  const catalog = (): Catalog => cache ??= (() => { const b = (baseCache ??= baseCatalog()); return { ...b, companies: withOverrides(b.companies, ov) } })()
  const company = (id: string) => { const c = catalog().companies.find((x) => x.id === id) ?? catalog().companies.find((x) => x.mergedFrom?.some((m) => m.id === id)); if (!c) throw new ViewerApiError('Unknown company.', 'NOT_FOUND'); return c }
  const guard = <T>(fn: () => T): T => { try { return fn() } catch (e) { if (e instanceof StoreError) throw new ViewerApiError(e.message, e.code); throw e } }
  /** Documents that really exist for this person and company. Nothing is offered that cannot be attached. */
  const attachOptions = (pid: string, companyId: string) => {
    const p = store.get(pid); const c = company(companyId)
    type Opt = { key: string; type: AttachmentKind; label: string; available: boolean; reason?: string; docVersionId?: string; recId?: string; cvVersionId?: string }
    const out: Opt[] = []
    const kindOf = (label: string, kind: string): AttachmentKind => /cover/i.test(label) ? 'COVER_LETTER' : /referral|industrial training/i.test(label) ? 'REFERRAL_LETTER' : (kind === 'CV' ? 'CV' : 'RESUME')
    const docs = [...p.documents.filter((d) => !d.archived && d.versions.length)].sort((a, b) => Number(b.id === p.masterDocId) - Number(a.id === p.masterDocId))
    for (const d of docs) {
      const ok = store.fileState(d.versions.at(-1)!) === 'OK'
      out.push({ key: `doc:${d.id}`, type: kindOf(d.label, d.kind), label: d.label, available: ok, docVersionId: d.versions.at(-1)!.id, reason: ok ? undefined : 'The file is missing or changed on disk.' })
    }
    const myIds = new Set([c.id, ...(c.mergedFrom ?? []).map((m) => m.id)])
    for (const r of (p.cvs ?? []).filter((x) => x.mode === 'TAILORED' && x.companyId && myIds.has(x.companyId))) {
      const ap = r.versions.filter((v) => v.status === 'APPROVED').at(-1)
      out.push({ key: `cv:${r.id}`, type: 'CV', label: `Tailored CV for ${c.name} (${r.role ?? 'general'})`, available: !!ap, recId: r.id, cvVersionId: ap?.id, reason: ap ? undefined : 'Approve this CV first. A draft has not been exported.' })
    }
    for (const t of ['COVER_LETTER', 'REFERRAL_LETTER'] as const) if (!out.some((o) => o.type === t && o.available)) out.push({ key: `missing:${t}`, type: t, label: t === 'COVER_LETTER' ? 'Cover letter' : 'Faculty Industrial Training referral letter', available: false, reason: 'Not added yet. Upload it in My Resumes with that name.' })
    const first = (t: AttachmentKind) => out.find((o) => o.type === t && o.available)?.key
    const defaults = [first('RESUME'), out.find((o) => o.key.startsWith('cv:') && o.available)?.key].filter(Boolean) as string[]
    return { options: out, defaults }
  }
  const emailDraft = (a: { profileId: string; companyId: string; role?: any; attachmentKeys?: string[]; includeAvailability?: boolean; recipientKey?: string | null }) => guard(() => {
    const { options, defaults } = attachOptions(a.profileId, a.companyId)
    const keys = Array.isArray(a.attachmentKeys) ? a.attachmentKeys : defaults
    const kinds = [...new Set(options.filter((o) => o.available && keys.includes(o.key)).map((o) => o.type))]
    return { ...draftEmail(store.get(a.profileId), company(a.companyId), { role: a.role ?? null, attachments: kinds, includeAvailability: a.includeAvailability, recipientKey: a.recipientKey }), attachmentKeys: keys.filter((k) => options.some((o) => o.available && o.key === k)) }
  })
  const roleFromLabel = (l: string | null | undefined): RoleFamily | null => (Object.keys(ROLE_LABEL) as RoleFamily[]).find((k) => ROLE_LABEL[k] === l) ?? null
  const cvView = (p: ReturnType<ViewerStore['get']>, recId: string, versionId: string, baseline: ResumeAST, role: RoleFamily | null, match: ReturnType<typeof suitability> | null) => {
    const r = store.cvGet(p.id, recId); const v = r.versions.find((x) => x.id === versionId)!
    return { rec: structuredClone(r), version: v, flags: unsupportedClaims(p, v.ast), diff: r.mode === 'MASTER' ? [] : diffCv(baseline, v.ast),
      presentation: { before: evidenceCoverage(p, baseline, role), after: evidenceCoverage(p, v.ast, role) }, suitability: match, label: r.vacancy === 'NONE' && r.mode === 'TAILORED' ? 'Company/Role Tailored — No Specific Vacancy Description' : null }
  }
  const facets = () => {
    const cs = catalog().companies, n = (f: (c: CatalogCompany) => boolean) => cs.filter(f).length
    const classes: Record<string, number> = {}; for (const c of cs) for (const k of c.classes) classes[k] = (classes[k] ?? 0) + 1
    const tech: Record<string, number> = {}; for (const c of cs) for (const k of c.tech) tech[k] = (tech[k] ?? 0) + 1
    const allowance: Record<string, number> = {}; for (const c of cs) allowance[c.allowance.status] = (allowance[c.allowance.status] ?? 0) + 1
    const evidence: Record<string, number> = {}; for (const c of cs) evidence[c.internship.evidence] = (evidence[c.internship.evidence] ?? 0) + 1
    const contact: Record<string, number> = {}; for (const c of cs) { const k = contactSummary(c).state; contact[k] = (contact[k] ?? 0) + 1 }
    return { total: cs.length, contact, cities: { Cyberjaya: n((c) => c.city === 'Cyberjaya'), Putrajaya: n((c) => c.city === 'Putrajaya'), 'IOI Resort City': n((c) => c.city === 'IOI Resort City') }, sector: { GOVERNMENT: n((c) => c.sector === 'GOVERNMENT'), NON_GOVERNMENT: n((c) => c.sector === 'NON_GOVERNMENT') }, classes, tech, allowance, evidence }
  }

  const h = {
    // ---- profiles
    'v.profiles': async () => store.summary(),
    'v.profile.get': async (a: { id: string }) => guard(() => structuredClone(store.get(a.id))),
    'v.profile.patch': async (a: { id: string; patch: any }) => guard(() => store.patch(a.id, a.patch ?? {})),
    'v.profile.copy': async (a: { id: string }) => guard(() => {
      const p = store.get(a.id)
      return [p.fullName, p.degree && `${p.degree}, ${p.university}`, [p.contact.email, p.contact.phone, p.contact.location].filter(Boolean).join(' | '), p.links.map((l) => `${l.label}: ${l.url}`).join('\n'),
        p.skills.length ? 'Skills\n' + p.skills.map((s) => `${s.group}: ${s.items.join(', ')}`).join('\n') : '', p.education.length ? 'Education\n' + p.education.map((e) => `${e.title}, ${e.institution}${e.dates ? ` (${e.dates})` : ''}${e.points.length ? ' – ' + e.points.join('; ') : ''}`).join('\n') : ''].filter(Boolean).join('\n\n')
    }),

    // ---- documents (CV / resume viewer)
    'v.docs.list': async (a: { id: string }) => guard(() => store.documents(a.id)),
    'v.docs.pick': async () => env.ui.pickFile('doc'),
    'v.docs.add': async (a: { id: string; path?: string; label?: string; kind?: 'CV' | 'RESUME'; docId?: string; note?: string }) => {
      const src = a.path ?? await env.ui.pickFile('doc'); if (!src) return null
      return guard(() => store.addFile(a.id, { src, label: a.label, kind: a.kind, docId: a.docId, note: a.note }))
    },
    'v.docs.rename': async (a: { id: string; docId: string; label: string }) => guard(() => store.rename(a.id, a.docId, a.label)),
    'v.docs.kind': async (a: { id: string; docId: string; kind: 'CV' | 'RESUME' }) => guard(() => store.setKind(a.id, a.docId, a.kind)),
    'v.docs.archive': async (a: { id: string; docId: string; archived: boolean }) => guard(() => store.archive(a.id, a.docId, a.archived)),
    'v.docs.bytes': async (a: { id: string; versionId: string }) => guard(() => {
      const { path: f, v } = store.versionPath(a.id, a.versionId)
      if (store.fileState(v) === 'MISSING') throw new ViewerApiError('That file is missing from disk.', 'FILE_MISSING')
      return new Uint8Array(fs.readFileSync(f))
    }),
    'v.docs.text': async (a: { id: string; versionId: string }) => {
      const { path: f, v } = guard(() => store.versionPath(a.id, a.versionId))
      if (!fs.existsSync(f)) throw new ViewerApiError('That file is missing from disk.', 'FILE_MISSING')
      if (!/\.docx$/i.test(v.file)) throw new ViewerApiError('Text preview is only needed for Word files.', 'BAD_INPUT')
      const m: any = await import('mammoth'); const r = await (m.default ?? m).extractRawText({ path: f })
      return String(r.value).replace(/\n{3,}/g, '\n\n').trim()
    },
    'v.docs.open': async (a: { id: string; versionId: string }) => env.ui.openPath(guard(() => store.versionPath(a.id, a.versionId)).path),
    'v.docs.exportCopy': async (a: { id: string; versionId: string }) => {
      const { path: f, v } = guard(() => store.versionPath(a.id, a.versionId))
      if (!fs.existsSync(f)) throw new ViewerApiError('That file is missing from disk.', 'FILE_MISSING')
      const downloads = path.join(env.userDataDir, 'viewer', 'exports'); fs.mkdirSync(downloads, { recursive: true })
      let dest = path.join(downloads, v.originalName), n = 1
      while (fs.existsSync(dest)) dest = path.join(downloads, `${path.basename(v.originalName, path.extname(v.originalName))} (${n++})${path.extname(v.originalName)}`)
      fs.copyFileSync(f, dest); await env.ui.openPath(path.dirname(dest)); return dest
    },

    'v.about': async () => ({ dataDir: path.join(env.userDataDir, 'viewer'), catalogSource: catalog().sourceFile, catalogGeneratedAt: catalog().generatedAt, companies: catalog().companies.length, profilesSeeded: store.list().map((p) => ({ id: p.id, seeded: p.seeded })) }),
    'v.openDataFolder': async () => env.ui.openPath(path.join(env.userDataDir, 'viewer')),

    // ---- companies
    'v.catalog.meta': async () => { const c = catalog(); return { generatedAt: c.generatedAt, sourceFile: c.sourceFile, total: c.companies.length, facets: facets() } },
    'v.companies.list': async (a: CatalogFilter & { profileId?: string; role?: RoleFamily; sort?: SortKey; contact?: string }) => {
      const student = a?.profileId ? guard(() => store.get(a.profileId!)) : null
      const CONTACT_FILTER: Record<string, ContactState> = { VERIFIED_EMAIL: 'VERIFIED_EMAIL', GENERAL_EMAIL: 'GENERAL_EMAIL', PORTAL: 'PORTAL', PENDING: 'PENDING', NONE: 'NONE' }
      const want = a?.contact && CONTACT_FILTER[a.contact]
      const rows = filterCatalog(catalog().companies, a ?? {}).map((c) => ({ c, cs: contactSummary(c) })).filter(({ cs }) => !want || cs.state === want).map(({ c, cs }) => {
        const m = student ? suitability(student, c, a.role) : null
        return { id: c.id, name: c.name, city: c.city, sector: c.sector, classes: c.classes, tech: c.tech, allowanceStatus: c.allowance.status, allowance: allowanceHeadline(c), allowanceMin: c.allowance.status === 'CONFIRMED_PAID' || c.allowance.status === 'HISTORICAL' ? c.allowance.monthlyMin : null, evidence: c.internship.evidence, verification: c.verificationLevel, categoryLabel: c.categoryLabel, hasEmail: !!(c.contacts.hrEmail || c.contacts.generalEmail), priorLead: !!c.priorLead,
          match: m && { score: m.score, tier: m.tier, provisional: m.provisional, confidence: m.confidence, role: m.role, roleLabel: m.roleLabel }, contact: { state: cs.state, label: cs.label, tone: cs.tone, historical: cs.historical, needsResearch: cs.needsResearch }, _ease: cs.readiness, _tech: m ? m.dimensions[1].value + m.dimensions[0].value : 0, _conf: m ? m.dimensions[5].value : 0 }
      })
      const key = a?.sort ?? (student ? 'match' : null)
      const cmp: Record<string, (x: any, y: any) => number> = {
        match: (x, y) => (y.match?.score ?? 0) - (x.match?.score ?? 0), allowance: (x, y) => (y.allowanceMin ?? -1) - (x.allowanceMin ?? -1), technical: (x, y) => y._tech - x._tech,
        verified: (x, y) => EVIDENCE_ORDER.indexOf(x.evidence) - EVIDENCE_ORDER.indexOf(y.evidence), contact: (x, y) => y._ease - x._ease, confidence: (x, y) => y._conf - x._conf, name: (x, y) => x.name.localeCompare(y.name),
      }
      const ordered = key ? rows.sort((x, y) => (cmp[key] ?? cmp.name)(x, y) || x.name.localeCompare(y.name)) : rows
      return ordered.map(({ _ease, _tech, _conf, ...r }) => r)
    },
    'v.match.explain': async (a: { profileId: string; companyId: string; role?: RoleFamily }) => guard(() => suitability(store.get(a.profileId), company(a.companyId), a.role)),
    'v.match.roles': async (a: { profileId: string; companyId: string }) => guard(() => { const c = company(a.companyId); const offered = companyRoles(c); return { offered: offered.map((r) => ({ id: r, label: ROLE_LABEL[r] })), all: (Object.keys(ROLE_LABEL) as RoleFamily[]).map((r) => ({ id: r, label: ROLE_LABEL[r] })), default: defaultRole(store.get(a.profileId), c) } }),
    'v.companies.get': async (a: { id: string }) => { const c = company(a.id); return { ...c, contactSummary: contactSummary(c), recipientChoices: recipientChoices(c) } },
    'v.companies.compare': async (a: { ids: string[]; priority?: Priority }) => {
      if (!Array.isArray(a.ids) || a.ids.length < 2 || a.ids.length > 4) throw new ViewerApiError('Choose 2 to 4 organisations to compare.', 'BAD_INPUT')
      return compare(a.ids.map((i) => toCompare(company(i))), a.priority ?? 'balanced', new Date())
    },
    'v.copy.company': async (a: { id: string }) => companyDetailsText(company(a.id)),
    'v.copy.contact': async (a: { id: string }) => contactText(company(a.id)),
    'v.contacts.confirm': async (a: { companyId: string; key: string; on?: boolean }) => guard(() => {
      const c = company(a.companyId); const r = contactSummary(c).routes.find((x) => x.key === a.key); if (!r) throw new ViewerApiError('Unknown contact route.', 'NOT_FOUND')
      const list = (ov.confirmed[c.id] ??= []).filter((x) => !(x.kind === r.kind && x.value.toLowerCase() === r.value.toLowerCase()))
      if (a.on !== false) list.push({ value: r.value, kind: r.kind, tier: r.tier, label: r.label, note: 'Confirmed by you in Career Hub.', at: new Date().toISOString() })
      ov.confirmed[c.id] = list; if (!list.length) delete ov.confirmed[c.id]; writeOverrides(ovFile, ov); cache = null
      const c2 = company(a.companyId); return { ...c2, contactSummary: contactSummary(c2), recipientChoices: recipientChoices(c2) }
    }),
    'v.contacts.research': async (a: { companyId: string; on?: boolean }) => guard(() => {
      const c = company(a.companyId); ov.research = ov.research.filter((x) => x !== c.id); if (a.on !== false) ov.research.push(c.id); writeOverrides(ovFile, ov); cache = null
      const c2 = company(a.companyId); return { ...c2, contactSummary: contactSummary(c2), recipientChoices: recipientChoices(c2) }
    }),
    'v.contacts.import': async () => {
      if (!env.researchDir) throw new ViewerApiError('No research folder is configured.', 'BAD_INPUT')
      const research = await readContactResearch(env.researchDir)
      if (!research.master.length) throw new ViewerApiError(`The contact research files were not found in ${env.researchDir}.`, 'BAD_FILE')
      const { catalog: merged, report } = applyContactResearch(baseCatalog(), research)
      writeCatalog(catFile, merged); baseCache = merged; cache = null
      let exported: string | null = null
      if (env.exportsDir) { fs.mkdirSync(env.exportsDir, { recursive: true }); const miss = missingEmployers(merged); for (const f of fs.readdirSync(env.exportsDir)) if (/^CAREER_HUB_MISSING_\d+_CONTACT_RESEARCH\.csv$/.test(f)) fs.rmSync(path.join(env.exportsDir, f)); exported = path.join(env.exportsDir, missingFileName(miss.length)); fs.writeFileSync(exported, missingCsv(miss)) }
      return { ...report, warnings: report.warnings.slice(0, 20), exported }
    },
    'v.copy.apply': async (a: { id: string }) => applicationText(company(a.id)),
    'v.copy.allowance': async (a: { id: string }) => allowanceText(company(a.id)),
    'v.email.draft': async (a: { profileId: string; companyId: string; role?: string; attachmentKeys?: string[]; includeAvailability?: boolean; recipientKey?: string | null }) => emailDraft(a),
    'v.email.attachments': async (a: { profileId: string; companyId: string }) => guard(() => attachOptions(a.profileId, a.companyId)),
    'v.email.mailto': async (a: { to: string; subject: string; body: string }) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a?.to ?? '')) throw new ViewerApiError('There is no verified recipient address to open.', 'BAD_INPUT')
      env.ui.openExternal(`mailto:${a.to}?subject=${encodeURIComponent(String(a.subject ?? '').slice(0, 300))}&body=${encodeURIComponent(String(a.body ?? '').slice(0, 6000))}`); return true
    },
    'v.copy.text': async (a: { text: string }) => { if (typeof a?.text !== 'string') throw new ViewerApiError('Nothing to copy.', 'BAD_INPUT'); env.ui.copy(a.text.slice(0, 200000)); return true },
    // ---- CV drafts (both students) and Akif's one-time master refresh
    'v.cv.list': async (a: { id: string }) => guard(() => store.cvList(a.id).map((r) => ({ ...r, versions: r.versions.map(({ ast, ...v }) => v) }))),
    'v.cv.get': async (a: { id: string; recId: string }) => guard(() => {
      const r = store.cvGet(a.id, a.recId); const p = store.get(a.id)
      return { rec: structuredClone(r), withFlags: r.versions.map((v) => ({ id: v.id, flags: unsupportedClaims(p, v.ast) })) }
    }),
    'v.cv.tailor': async (a: { profileId: string; companyId: string; role?: RoleFamily; recId?: string }) => guard(() => {
      const p = store.get(a.profileId); const c = company(a.companyId)
      const role = a.role ?? defaultRole(p, c)
      const built = buildTailored(p, { company: c.name, role, vacancy: 'NONE' })
      const baseline = buildMaster(p)
      const existing = a.recId ? undefined : (p.cvs ?? []).find((r) => r.mode === 'TAILORED' && r.companyId === c.id && r.role === ROLE_LABEL[role])
      const last = existing?.versions.at(-1)
      if (last && last.status === 'DRAFT' && last.source === 'generated' && JSON.stringify(last.ast) === JSON.stringify(built.ast)) return cvView(p, existing!.id, last.id, baseline.ast, role, suitability(p, c, role))
      const { rec, version } = store.cvAddVersion(p.id, { recId: a.recId ?? existing?.id, mode: 'TAILORED', label: built.label, companyId: c.id, companyName: c.name, role: ROLE_LABEL[role], vacancy: 'NONE' }, { ast: built.ast, note: 'Generated offline from your profile facts.', source: 'generated' })
      return cvView(p, rec.id, version.id, baseline.ast, role, suitability(p, c, role))
    }),
    'v.cv.edit': async (a: { id: string; recId: string; versionId: string; summary?: string; bullets?: Record<string, string | null>; dropItems?: string[] }) => guard(() => {
      const p = store.get(a.id); const r = store.cvGet(a.id, a.recId); const prev = r.versions.find((v) => v.id === a.versionId); if (!prev) throw new ViewerApiError('Unknown version.', 'NOT_FOUND')
      const ast: ResumeAST = structuredClone(prev.ast)
      if (typeof a.summary === 'string') ast.summary = { text: a.summary.slice(0, 1200), factIds: [] }
      for (const s of ast.sections) {
        s.items = (s.items ?? []).filter((i) => !(a.dropItems ?? []).includes(i.id))
        for (const i of s.items) i.bullets = i.bullets.flatMap((b) => { const e = a.bullets?.[b.id]; return e === undefined ? [b] : e === null ? [] : [{ ...b, text: e.slice(0, 600) }] })
      }
      const { version } = store.cvAddVersion(a.id, { recId: a.recId, mode: r.mode, label: r.label, vacancy: r.vacancy }, { ast, note: 'Edited by you.', source: 'edited' })
      const baseline = buildMaster(p); const role = roleFromLabel(r.role)
      return cvView(p, a.recId, version.id, baseline.ast, role, r.companyId ? suitability(p, company(r.companyId), role ?? undefined) : null)
    }),
    'v.cv.restore': async (a: { id: string; recId: string; versionId: string }) => guard(() => {
      const p = store.get(a.id); const r = store.cvGet(a.id, a.recId); const prev = r.versions.find((v) => v.id === a.versionId); if (!prev) throw new ViewerApiError('Unknown version.', 'NOT_FOUND')
      const { version } = store.cvAddVersion(a.id, { recId: a.recId, mode: r.mode, label: r.label, vacancy: r.vacancy }, { ast: prev.ast, note: `Restored from version ${prev.n}.`, source: 'restored' })
      const role = roleFromLabel(r.role)
      return cvView(p, a.recId, version.id, buildMaster(p).ast, role, r.companyId ? suitability(p, company(r.companyId), role ?? undefined) : null)
    }),
    'v.cv.preview': async (a: { id: string; recId: string; versionId: string }) => {
      const v = guard(() => store.cvGet(a.id, a.recId)).versions.find((x) => x.id === a.versionId); if (!v) throw new ViewerApiError('Unknown version.', 'NOT_FOUND')
      if (v.file) return new Uint8Array(fs.readFileSync(guard(() => store.cvFilePath(a.id, a.recId, a.versionId))))
      return new Uint8Array((await renderCv(v.ast, { targetPages: 2, subject: 'Resume' })).buffer)
    },
    'v.cv.approve': async (a: { id: string; recId: string; versionId: string; acknowledgeFlags?: boolean }) => {
      const p = guard(() => store.get(a.id)); const r = guard(() => store.cvGet(a.id, a.recId)); const v = r.versions.find((x) => x.id === a.versionId); if (!v) throw new ViewerApiError('Unknown version.', 'NOT_FOUND')
      const flags = unsupportedClaims(p, v.ast)
      if (flags.length && !a.acknowledgeFlags) throw new ViewerApiError(`Review before approving: ${flags.join(' ')}`, 'UNSUPPORTED_CLAIMS')
      const pdf = await renderCv(v.ast, { targetPages: 2, subject: 'Resume' })
      const name = r.mode === 'MASTER' ? `${p.displayName}_Master_Resume.pdf` : fileNameFor(p, r.companyName ?? 'General', r.role ?? null)
      const ver = guard(() => store.cvApprove(a.id, a.recId, a.versionId, pdf.buffer, name, pdf.pages))
      let masterDocId: string | null = null
      if (r.mode === 'MASTER') {
        // The approved master becomes a new document beside the original. The original file is never touched.
        const src = guard(() => store.cvFilePath(a.id, a.recId, a.versionId))
        const same = p.masterDocId ? { docId: p.masterDocId } : undefined
        const out = guard(() => store.addFile(a.id, { src, label: 'Master Resume (2026 refresh)', kind: 'RESUME', docId: same?.docId, note: 'Approved master. The earlier resume is kept unchanged.' }))
        guard(() => store.setMasterDoc(a.id, out.docId)); masterDocId = out.docId
      }
      return { version: ver, pages: pdf.pages, masterDocId }
    },
    'v.cv.export': async (a: { id: string; recId: string; versionId: string }) => {
      const src = guard(() => store.cvFilePath(a.id, a.recId, a.versionId))
      const dir = path.join(env.userDataDir, 'viewer', 'exports'); fs.mkdirSync(dir, { recursive: true })
      let dest = path.join(dir, path.basename(src)), n = 2
      while (fs.existsSync(dest)) dest = path.join(dir, `${path.basename(src, '.pdf')}-${n++}.pdf`)
      fs.copyFileSync(src, dest); await env.ui.openPath(dir); return dest
    },
    'v.cv.master.create': async (a: { id: string }) => guard(() => {
      if (a.id !== 'akif') throw new StoreError('A refreshed master resume is only prepared for Akif. Adam\'s resume is kept exactly as it is.', 'NOT_ALLOWED')
      const p = store.get('akif'); const built = buildMaster(p)
      const existing = (p.cvs ?? []).find((r) => r.mode === 'MASTER'); const last = existing?.versions.at(-1)
      if (last && last.status === 'DRAFT' && last.source === 'generated' && JSON.stringify(last.ast) === JSON.stringify(built.ast)) return cvView(p, existing!.id, last.id, built.ast, null, null)
      const { rec, version } = store.cvAddVersion('akif', { recId: existing?.id, mode: 'MASTER', label: 'Master Resume (2026 refresh)', vacancy: 'NONE' }, { ast: built.ast, note: 'Built from your verified profile. Review before approving.', source: 'generated' })
      return cvView(p, rec.id, version.id, built.ast, null, null)
    }),
    'v.openExternal': async (a: { url: string }) => { if (!/^https?:\/\/[^\s]+$/i.test(a.url ?? '')) throw new ViewerApiError('Only http(s) links can be opened.', 'BAD_INPUT'); env.ui.openExternal(a.url); return true },

    // ---- catalogue update (XLSX → JSON, merged safely)
    'v.catalog.pick': async () => env.ui.pickFile('workbook'),
    'v.catalog.preview': async (a: { path?: string }) => {
      const src = a.path ?? await env.ui.pickFile('workbook'); if (!src) return null
      const { catalog: inc, warnings } = await catalogFromWorkbook(src).catch((e) => { throw new ViewerApiError(e?.message ?? 'Could not read that workbook.', 'BAD_FILE') })
      const { report } = mergeCatalog(readCatalog(catFile) ?? readCatalog(env.bundledCatalog), inc)
      return { path: src, filename: inc.sourceFile, rows: inc.companies.length, warnings, report }
    },
    'v.catalog.apply': async (a: { path: string }) => {
      const { catalog: inc } = await catalogFromWorkbook(a.path).catch((e) => { throw new ViewerApiError(e?.message ?? 'Could not read that workbook.', 'BAD_FILE') })
      const { catalog: merged, report } = mergeCatalog(readCatalog(catFile) ?? readCatalog(env.bundledCatalog), inc)
      writeCatalog(catFile, merged); baseCache = merged; cache = null
      return report
    },
  }
  return {
    store, handlers: h, profileIds: PROFILE_IDS,
    async call(name: string, args?: unknown): Promise<any> {
      const fn = (h as Record<string, (a: any) => Promise<unknown>>)[name]
      if (!fn) throw new ViewerApiError(`Unknown API call: ${name}`, 'NOT_FOUND')
      return fn(args)
    },
  }
}
