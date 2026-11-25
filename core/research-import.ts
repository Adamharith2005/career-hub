import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DB, all, get, run, tx, nowIso, id } from './db.ts'
import { slugify, classifyRoleFamilies } from './domain.ts'
import { classifyOrg, classifyAllowance, internshipEvidenceFrom, normalizeOrgKey, type AllowanceClass } from './research-classify.ts'
import { FIELD_SYNONYMS, inspectSheets, parseLeads, readWorkbookFile, ImportError, MAX_FILE_BYTES, MAX_ROWS, findHeader, mapHeaders, txt, safeUrl, nz, type Cell, type Sheets, type SheetInfo, type Lead } from './research-parse.ts'
export { FIELD_SYNONYMS, inspectSheets, parseLeads, readWorkbookFile, ImportError, MAX_FILE_BYTES, MAX_ROWS, findHeader, mapHeaders }
export type { Cell, Sheets, SheetInfo, Lead }

/* ---------- planning ---------- */

export type Outcome = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'CONFLICT' | 'OFFICE_ADDED'
export interface PlanRow { lead: Lead; outcome: Outcome; companyId: string; diff: Record<string, { from: unknown; to: unknown }>; conflicts: string[]; values: CompanyValues }
export interface ImportPlan { rows: PlanRow[]; counts: Record<Outcome, number>; warnings: string[]; sheets: SheetInfo[] }

interface CompanyValues {
  name: string; legal_entity: string | null; ownership_type: string | null; company_size: string | null; industry: string | null
  cs_relevance: string | null; relevant_roles: string | null; address: string | null; office_status: string | null
  website: string | null; careers_page: string | null; hr_email: string | null; general_contact: string | null; linkedin: string | null
  recommended_method: string | null; evidence_sources: string | null; last_verified: string | null; research_notes: string | null
  tech_departments: string | null; deadline_text: string | null; required_docs: string | null; application_url: string | null
  sector_group: string; classes_json: string; city: string | null; verification_level: string; internship_evidence: string; lead_id: string | null
  suitability_score: number | null; contact_score: number | null
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/i
const OFFICE_RANK: Record<string, number> = { UNVERIFIED: 0, HISTORICAL: 0, PROBABLE: 1, VERIFIED: 2 }
const EVID_RANK: Record<string, number> = { UNKNOWN: 0, DIRECT_OUTREACH: 0, NOT_ACCEPTING: 1, HISTORICAL: 1, CONFIRMED_PROGRAMME: 2, ACTIVE_OPENING: 3 }

function officeLevel(audit: string): string {
  if (/^official/i.test(audit)) return 'VERIFIED'
  if (/^supported/i.test(audit)) return 'PROBABLE'
  return 'UNVERIFIED'
}

export function valuesFor(l: Lead): CompanyValues {
  const f = l.f
  const cls = classifyOrg(f.ownership)
  const contactRaw = f.contact ?? ''
  const hr = nz(f.hrEmail ?? '') ?? null
  const internship = internshipEvidenceFrom({ raw: f.internshipRaw || f.rawInternship || null, audit: f.internshipAudit || null })
  const careers = safeUrl(f.careers)
  return {
    name: l.name, legal_entity: nz(f.legal ?? ''), ownership_type: nz(f.ownership ?? ''), company_size: nz(f.size ?? ''), industry: nz(f.industry ?? ''),
    cs_relevance: nz(f.relevance ?? ''), relevant_roles: nz(f.roles ?? ''), address: nz(f.address ?? ''), office_status: nz(f.officeAudit ?? ''),
    website: safeUrl(f.website), careers_page: careers, hr_email: hr && EMAIL.test(hr) ? (EMAIL.exec(hr)![0]) : null,
    general_contact: nz(contactRaw), linkedin: safeUrl(f.linkedin), recommended_method: nz(f.method ?? ''), evidence_sources: nz(f.evidence ?? ''),
    last_verified: /^\d{4}-\d{2}-\d{2}/.test(f.auditChecked ?? '') ? f.auditChecked.slice(0, 10) : (nz(f.lastVerified ?? '') ?? null),
    research_notes: nz(f.notes ?? ''), tech_departments: nz(f.techDivision ?? ''), deadline_text: nz(f.deadline ?? ''), required_docs: nz(f.docs ?? ''),
    application_url: careers, sector_group: cls.sector, classes_json: JSON.stringify(cls.classes), city: l.city,
    verification_level: officeLevel(f.officeAudit ?? ''), internship_evidence: internship, lead_id: l.leadId,
    suitability_score: Number(f.suitability) || null, contact_score: Number(f.contactScore) || null,
  }
}

const TRACKED: (keyof CompanyValues)[] = ['name', 'legal_entity', 'ownership_type', 'company_size', 'industry', 'cs_relevance', 'relevant_roles', 'address', 'office_status', 'website', 'careers_page',
  'hr_email', 'general_contact', 'linkedin', 'recommended_method', 'evidence_sources', 'last_verified', 'research_notes', 'tech_departments', 'deadline_text', 'required_docs', 'application_url',
  'sector_group', 'classes_json', 'city', 'verification_level', 'internship_evidence', 'lead_id', 'suitability_score', 'contact_score']

function findExisting(db: DB, l: Lead, key: string): any | null {
  const prefix = l.city === 'Putrajaya' ? 'pj' : 'cj'
  const byId = get(db, 'SELECT * FROM companies WHERE company_id = ? AND profile_id IS NULL', `${prefix}-${slugify(l.name, 60)}`)
  if (byId) return byId
  const cands = all(db, 'SELECT * FROM companies WHERE profile_id IS NULL AND org_key = ?', key)
  if (cands.length) return cands.find((c: any) => c.city === l.city) ?? cands[0]
  // Existing (pre-3.0) seed rows have no org_key yet.
  const legacy = all(db, 'SELECT * FROM companies WHERE profile_id IS NULL AND org_key IS NULL')
  return legacy.find((c: any) => normalizeOrgKey(c.name) === key) ?? null
}

export function planImport(db: DB, parsed: { leads: Lead[]; sheets: SheetInfo[]; warnings: string[] }): ImportPlan {
  const counts: Record<Outcome, number> = { NEW: 0, CHANGED: 0, UNCHANGED: 0, CONFLICT: 0, OFFICE_ADDED: 0 }
  const rows: PlanRow[] = []
  for (const lead of parsed.leads) {
    const v = valuesFor(lead)
    const key = normalizeOrgKey(lead.name)
    const ex = findExisting(db, lead, key)
    if (!ex) {
      const companyId = `${lead.city === 'Putrajaya' ? 'pj' : 'cj'}-${slugify(lead.name, 60)}`
      rows.push({ lead, outcome: 'NEW', companyId, diff: {}, conflicts: [], values: v }); counts.NEW++; continue
    }
    if (ex.city && lead.city && ex.city !== lead.city) {
      rows.push({ lead, outcome: 'OFFICE_ADDED', companyId: ex.company_id, diff: {}, conflicts: [], values: v }); counts.OFFICE_ADDED++; continue
    }
    const diff: PlanRow['diff'] = {}
    const conflicts: string[] = []
    const apply: Partial<CompanyValues> = {}
    for (const k of TRACKED) {
      const to = v[k] as unknown, from = (ex as any)[k] ?? null
      if ((to ?? null) === from || (to == null && from == null)) continue
      if (to == null) continue                                  // never blank out existing data from a sparser sheet
      if (k === 'verification_level' && (OFFICE_RANK[to as string] ?? 0) < (OFFICE_RANK[from as string] ?? 0) && ex.lead_id) { conflicts.push(k); continue }
      if (k === 'internship_evidence' && (EVID_RANK[to as string] ?? 0) < (EVID_RANK[from as string] ?? 0) && ex.lead_id) { conflicts.push(k); continue }
      // Legacy seed rows (no lead_id) are from an unaudited source. Audited values may replace them; classification fields always do.
      diff[k] = { from, to }
    }
    void apply
    const outcome: Outcome = conflicts.length ? 'CONFLICT' : Object.keys(diff).length ? 'CHANGED' : 'UNCHANGED'
    rows.push({ lead, outcome, companyId: ex.company_id, diff, conflicts, values: v }); counts[outcome]++
  }
  return { rows, counts, warnings: parsed.warnings, sheets: parsed.sheets }
}

/* ---------- applying ---------- */

export interface ImportReport { batchId: string | null; alreadyImported: boolean; counts: Record<Outcome, number>; companies: number; allowanceRows: number; sources: number; warnings: string[] }

const toTier = (score: number | null, relevance: string | null) => score != null && score >= 86 ? 'T1' : score != null && score >= 78 ? 'T2' : /core cs|highly/i.test(relevance ?? '') ? 'T3' : 'T4'

export function applyImport(db: DB, parsed: { leads: Lead[]; sheets: SheetInfo[]; warnings: string[] }, meta: { filename: string; sha256: string }, opts: { skipIds?: Set<string> } = {}): ImportReport {
  const dupe = get<{ batch_id: string }>(db, 'SELECT batch_id FROM import_batches WHERE sha256 = ?', meta.sha256)
  if (dupe) return { batchId: dupe.batch_id, alreadyImported: true, counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0, CONFLICT: 0, OFFICE_ADDED: 0 }, companies: 0, allowanceRows: 0, sources: 0, warnings: ['This exact workbook was already imported. Nothing changed.'] }
  const plan = planImport(db, parsed)
  const batchId = id('imp')
  let allowanceRows = 0, sources = 0
  tx(db, () => {
    run(db, 'INSERT INTO import_batches (batch_id, filename, sha256, created_at, summary_json) VALUES (?,?,?,?,?)', batchId, meta.filename, meta.sha256, nowIso(), JSON.stringify({ counts: plan.counts }))
    for (const pr of plan.rows) {
      const { lead, outcome, companyId, values: v } = pr
      if (opts.skipIds?.has(companyId)) continue
      const fams = classifyRoleFamilies(`${v.relevant_roles ?? ''} ${v.industry ?? ''}`)
      if (/core cs/i.test(v.cs_relevance ?? '') && !fams.includes('swe')) fams.push('swe')
      const flags: string[] = []
      if (!v.website) flags.push('MISSING_WEBSITE')
      if (/not supported/i.test(lead.f.officeAudit ?? '')) flags.push('OFFICE_NOT_SUPPORTED')
      const code = (lead.f.internshipRaw || '').trim().toUpperCase()
      const codeEnum: Record<string, string> = { A: 'VERIFIED_ACTIVE_VACANCY', B: 'DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING', C: 'PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK', D: 'UNADVERTISED_SPECULATIVE_TARGET' }

      if (outcome === 'NEW') {
        run(db, `INSERT INTO companies (company_id, seed_rank, name, legal_entity, ownership_type, company_size, industry, cs_relevance, relevant_roles, role_families_json, address, address_precision, office_status,
          status_code_raw, status_enum, priority_tier, website, careers_page, hr_email, general_contact, linkedin, recommended_method, suitability_score, contact_score, evidence_sources, last_verified, research_notes,
          flags_json, raw_json, is_seed, imported_at, city, sector_group, classes_json, lead_id, org_key, verification_level, internship_evidence, tech_departments, deadline_text, required_docs, application_url)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)`,
          companyId, null, v.name, v.legal_entity, v.ownership_type, v.company_size, v.industry, v.cs_relevance, v.relevant_roles, JSON.stringify(fams), v.address,
          v.verification_level === 'VERIFIED' ? 'BUILDING_VERIFIED' : 'CITY_ONLY', v.office_status, code && codeEnum[code] ? code : null, codeEnum[code] ?? 'NEEDS_VERIFICATION',
          toTier(v.suitability_score, v.cs_relevance), v.website, v.careers_page, v.hr_email, v.general_contact, v.linkedin, v.recommended_method, v.suitability_score, v.contact_score,
          v.evidence_sources, v.last_verified, v.research_notes, JSON.stringify(flags), JSON.stringify(lead.f), nowIso(), v.city, v.sector_group, v.classes_json, v.lead_id, normalizeOrgKey(v.name),
          v.verification_level, v.internship_evidence, v.tech_departments, v.deadline_text, v.required_docs, v.application_url)
      } else if (outcome !== 'OFFICE_ADDED') {
        // Always attach org_key/classification so legacy seed rows join the 3.0 model; apply audited diffs; leave conflicts untouched.
        const sets = Object.keys(pr.diff).map((k) => `${k} = ?`)
        const vals = Object.values(pr.diff).map((d) => d.to)
        run(db, `UPDATE companies SET ${[...sets, 'org_key = ?', 'city = COALESCE(city, ?)', 'role_families_json = ?', 'imported_at = ?'].join(', ')} WHERE company_id = ?`,
          ...vals, normalizeOrgKey(v.name), v.city, JSON.stringify(fams), nowIso(), companyId)
      }
      // office record (one per city; same organisation in two cities keeps one canonical row)
      if (v.city) run(db, `INSERT INTO company_offices (office_id, company_id, city, address, verification, verification_note) VALUES (?,?,?,?,?,?)
        ON CONFLICT(company_id, city) DO UPDATE SET address = COALESCE(excluded.address, address), verification = excluded.verification, verification_note = excluded.verification_note`,
        id('off'), companyId, v.city, v.address, v.verification_level, nz(lead.f.officeAudit ?? ''))
      // sources
      const src = (url: string | null, description: string, supports: string, date: string | null, confidence: string) => {
        if (!url) return                                  // a source without a URL is not citable; the claim stays in provenance
        const r = run(db, `INSERT OR IGNORE INTO research_sources (source_id, company_id, url, description, source_date, confidence, supports, batch_id) VALUES (?,?,?,?,?,?,?,?)`,
          id('src'), companyId, url, description, date, confidence, supports, batchId)
        sources += Number(r.changes)
      }
      src(safeUrl(lead.f.verifyUrl), nz(lead.f.officeAudit ?? '') ?? 'Independent verification', 'OFFICE', v.last_verified, v.verification_level)
      src(safeUrl(lead.f.allowanceUrl), 'Allowance source cited in original workbook', 'ALLOWANCE', nz(lead.f.allowanceDate ?? ''), lead.allowance.grade)
      // allowance evidence: one import-derived row per company, updated in place on re-import
      const a = lead.allowance
      const aid = `al-${companyId}-import`
      const { min, max } = { min: a.amountMin, max: a.amountMax }
      run(db, `INSERT INTO allowance_evidence (allowance_id, company_id, grade, amount_min, amount_max, payment_unit, monthly_min, monthly_max, conditions, benefits, evidence_url, source_date, verified_at, claim_text, policy_ref, note, batch_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(allowance_id) DO UPDATE SET grade=excluded.grade, amount_min=excluded.amount_min, amount_max=excluded.amount_max, payment_unit=excluded.payment_unit, monthly_min=excluded.monthly_min,
          monthly_max=excluded.monthly_max, conditions=excluded.conditions, benefits=excluded.benefits, evidence_url=excluded.evidence_url, source_date=excluded.source_date, verified_at=excluded.verified_at,
          claim_text=excluded.claim_text, policy_ref=excluded.policy_ref, note=excluded.note, batch_id=excluded.batch_id`,
        aid, companyId, a.grade, min, max, min != null ? 'MONTH' : null, min, max, nz(lead.f.allowanceConditions ?? ''), nz(lead.f.benefits ?? ''), safeUrl(lead.f.allowanceUrl) ?? safeUrl(lead.f.verifyUrl),
        nz(lead.f.allowanceDate ?? ''), /^\d{4}-\d{2}-\d{2}/.test(lead.f.auditChecked ?? '') ? lead.f.auditChecked.slice(0, 10) : null, a.claimText, a.policyRef ? 1 : 0, a.note, batchId)
      allowanceRows++
      run(db, `INSERT INTO import_rows (row_id, batch_id, company_id, sheet, source_row, outcome, original_json, diff_json) VALUES (?,?,?,?,?,?,?,?)`,
        id('row'), batchId, companyId, lead.sheet, lead.sourceRow, outcome, JSON.stringify(lead.f), JSON.stringify({ diff: pr.diff, conflicts: pr.conflicts }))
    }
  })
  return { batchId, alreadyImported: false, counts: plan.counts, companies: plan.rows.length, allowanceRows, sources, warnings: plan.warnings }
}

export async function importWorkbookFile(db: DB, file: string): Promise<ImportReport> {
  const wb = await readWorkbookFile(file)
  const parsed = parseLeads(wb.sheets)
  return applyImport(db, parsed, { filename: wb.filename, sha256: wb.sha256 })
}

export async function previewWorkbookFile(db: DB, file: string) {
  const wb = await readWorkbookFile(file)
  const parsed = parseLeads(wb.sheets)
  const plan = planImport(db, parsed)
  return { filename: wb.filename, sha256: wb.sha256, alreadyImported: !!get(db, 'SELECT 1 FROM import_batches WHERE sha256 = ?', wb.sha256), sheets: plan.sheets, counts: plan.counts, warnings: plan.warnings,
    sample: plan.rows.slice(0, 50).map((r) => ({ name: r.lead.name, city: r.lead.city, outcome: r.outcome, changed: Object.keys(r.diff), conflicts: r.conflicts })) }
}
