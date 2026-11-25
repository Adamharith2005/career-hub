/** Workbook parsing with no database dependency. Used by the viewer and by the legacy importer. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { slugify, classifyRoleFamilies } from './domain.ts'
import { classifyOrg, classifyAllowance, internshipEvidenceFrom, normalizeOrgKey, type AllowanceClass } from './research-classify.ts'

/* ---------- parsing ---------- */

export type Cell = string | number | boolean | Date | null | undefined
export type Sheets = Record<string, Cell[][]>

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_ROWS = 20000
const MAX_TEXT = 4000

/** Canonical lead fields the importer understands, with header synonyms (matched after stripping "12. " numbering). */
export const FIELD_SYNONYMS: Record<string, RegExp> = {
  leadId: /^lead id$/i,
  city: /^location$/i,
  name: /^(organisation|organization|company name)$/i,
  legal: /legal entity/i,
  ownership: /^(ownership( \/ | )type)/i,
  size: /company size/i,
  industry: /^industry$/i,
  relevance: /cs relevance/i,
  roles: /(potential cs roles|relevant internship roles)/i,
  address: /(office address|verified .* office( address)?$)/i,
  officeAudit: /office verification status/i,
  internshipAudit: /internship acceptance evidence/i,
  allowanceAudit: /allowance evidence status/i,
  allowanceGuidance: /allowance guidance/i,
  allowanceClaim: /(original allowance claim|allowance amount)/i,
  allowanceGrade: /allowance confidence level/i,
  allowanceUrl: /allowance source url/i,
  allowanceDate: /allowance source date/i,
  allowanceConditions: /allowance conditions/i,
  benefits: /other benefits/i,
  paidStatus: /confirmed paid vs unpaid/i,
  website: /(official website)/i,
  careers: /(careers|application link|official careers page)/i,
  hrEmail: /public hr/i,
  contact: /(^contact \(|general email)/i,
  linkedin: /linkedin/i,
  method: /recommended application method/i,
  suitability: /(original )?suitability score/i,
  contactScore: /contact score/i,
  evidence: /evidence sources/i,
  lastVerified: /last verified/i,
  notes: /(research notes|notes \/ qualifications)/i,
  deadline: /application deadline/i,
  docs: /required documents/i,
  techDivision: /(relevant ict|tech division)/i,
  internshipRaw: /(internship status|intern status)$/i,
  verifyUrl: /independent verification url/i,
  nextAction: /what to do next/i,
  actionTier: /recommended action tier/i,
  sourceRow: /original source row/i,
  rank: /^(\d+\. )?rank$/i,
}

const stripNum = (h: string) => h.replace(/^\s*\d+\.\s*/, '').trim()
export const txt = (c: Cell): string => {
  if (c == null) return ''
  const s = c instanceof Date ? c.toISOString().slice(0, 10) : String(c)
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, MAX_TEXT)
}
export const safeUrl = (c: Cell): string | null => { const s = txt(c); return /^https?:\/\/[^\s]+$/i.test(s) ? s : null }
export const nz = (s: string): string | null => (!s || /^(unknown|not provided|n\/a|-)$/i.test(s) ? null : s)

export interface SheetInfo { name: string; headerRow: number; rows: number; role: 'LEADS' | 'RAW' | 'OTHER'; mapping: Record<string, number>; unmapped: string[] }

export function findHeader(rows: Cell[][]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const hs = rows[i].map((c) => stripNum(txt(c)))
    if (hs.some((h) => /^(lead id|rank)$/i.test(h)) && hs.some((h) => /^(organisation|organization|company name)$/i.test(h))) return i
  }
  return -1
}

export function mapHeaders(headers: string[]): { mapping: Record<string, number>; unmapped: string[] } {
  const mapping: Record<string, number> = {}
  const unmapped: string[] = []
  headers.forEach((raw, idx) => {
    const h = stripNum(raw)
    if (!h) return
    // Longest-specific first: most synonyms are anchored; allowance* before generic website/careers so they never steal columns.
    const key = Object.keys(FIELD_SYNONYMS).find((k) => !(k in mapping) && FIELD_SYNONYMS[k].test(h))
    if (key) mapping[key] = idx
    else unmapped.push(h)
  })
  return { mapping, unmapped }
}

export class ImportError extends Error {}

export function inspectSheets(sheets: Sheets): SheetInfo[] {
  return Object.entries(sheets).map(([name, rows]) => {
    const headerRow = findHeader(rows)
    if (headerRow < 0) return { name, headerRow: -1, rows: rows.length, role: 'OTHER' as const, mapping: {}, unmapped: [] }
    const headers = rows[headerRow].map(txt)
    const { mapping, unmapped } = mapHeaders(headers)
    const role = 'leadId' in mapping ? 'LEADS' as const : 'RAW' as const
    return { name, headerRow, rows: rows.length - headerRow - 1, role, mapping, unmapped }
  })
}

export interface Lead {
  sheet: string; sourceRow: number
  leadId: string | null; city: string | null; name: string
  f: Record<string, string>
  allowance: AllowanceClass
  /** Information carried by raw archive sheet only (kept in provenance). */
  rawFrom?: string
}

const recordFrom = (info: SheetInfo, rows: Cell[][], r: number): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, idx] of Object.entries(info.mapping)) out[k] = txt(rows[r][idx])
  return out
}

/** Parse a workbook into one merged lead per organisation row. The audited LEADS sheet wins over raw archive claims. */
export function parseLeads(sheets: Sheets): { leads: Lead[]; sheets: SheetInfo[]; warnings: string[] } {
  const infos = inspectSheets(sheets)
  const main = infos.find((i) => i.role === 'LEADS')
  const raws = infos.filter((i) => i.role === 'RAW')
  const warnings: string[] = []
  if (!main && !raws.length) throw new ImportError('No worksheet with an organisation list was found. Expected a header row containing "Lead ID"/"Rank" and "Organisation"/"Company Name".')
  const total = infos.reduce((n, i) => n + (i.role === 'OTHER' ? 0 : i.rows), 0)
  if (total > MAX_ROWS) throw new ImportError(`Workbook has ${total} rows; the limit is ${MAX_ROWS}.`)

  const rawIndex = new Map<string, { info: SheetInfo; rows: Cell[][]; byKey: Map<string, number> }>()
  for (const info of raws) {
    const rows = sheets[info.name]
    const byKey = new Map<string, number>()
    for (let r = info.headerRow + 1; r < rows.length; r++) {
      const nm = txt(rows[r][info.mapping.name]); if (nm) byKey.set(normalizeOrgKey(nm), r)
    }
    rawIndex.set(info.name, { info, rows, byKey })
  }
  const rawFor = (lead: Record<string, string>, city: string | null): { f: Record<string, string>; sheet: string; row: number } | null => {
    for (const { info, rows, byKey } of rawIndex.values()) {
      const key = normalizeOrgKey(lead.name)
      const m = /original row (\d+)/i.exec(lead.sourceRow ?? '')
      let r = -1
      if (m && Number(m[1]) - 1 < rows.length && normalizeOrgKey(txt(rows[Number(m[1]) - 1][info.mapping.name])) === key) r = Number(m[1]) - 1
      else if (byKey.has(key)) r = byKey.get(key)!
      if (r >= 0 && (!city || info.name.toLowerCase().includes(city.toLowerCase()) || true)) return { f: recordFrom(info, rows, r), sheet: info.name, row: r + 1 }
    }
    return null
  }

  const leads: Lead[] = []
  const seen = new Set<string>()
  const push = (sheet: string, row: number, f: Record<string, string>, city: string | null, rawFrom?: string) => {
    if (!f.name) return
    const key = `${(city ?? '').toLowerCase()}|${normalizeOrgKey(f.name)}`
    if (seen.has(key)) { warnings.push(`${sheet} row ${row}: duplicate organisation "${f.name}" skipped.`); return }
    seen.add(key)
    const allowance = classifyAllowance({ auditStatus: nz(f.allowanceAudit ?? '') ?? (f.paidStatus || null), originalClaim: f.allowanceClaim ?? null, rawGrade: f.allowanceGrade || null })
    leads.push({ sheet, sourceRow: row, leadId: f.leadId || null, city, name: f.name, f, allowance, rawFrom })
  }

  if (main) {
    const rows = sheets[main.name]
    for (let r = main.headerRow + 1; r < rows.length; r++) {
      if (!rows[r].some((c) => txt(c))) continue
      const base = recordFrom(main, rows, r)
      const city = /putrajaya/i.test(base.city) ? 'Putrajaya' : /cyberjaya/i.test(base.city) ? 'Cyberjaya' : null
      const raw = rawFor(base, city)
      // main wins; raw fills gaps only
      const f: Record<string, string> = { ...(raw?.f ?? {}), ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== '')) }
      if (raw) {
        // Raw archive labels stay available but must not override the audited values.
        f.rawInternship = raw.f.internshipRaw ?? ''
        f.rawAllowanceGrade = raw.f.allowanceGrade ?? ''
        f.allowanceGrade = raw.f.allowanceGrade ?? ''
        f.allowanceClaim = base.allowanceClaim || raw.f.allowanceClaim || ''
        f.allowanceUrl = raw.f.allowanceUrl ?? ''
        f.allowanceDate = raw.f.allowanceDate ?? ''
        f.allowanceConditions = raw.f.allowanceConditions ?? ''
        f.benefits = raw.f.benefits ?? ''
      }
      push(main.name, r + 1, f, city, raw ? `${raw.sheet} row ${raw.row}` : undefined)
    }
  } else {
    for (const info of raws) {
      const rows = sheets[info.name]
      const city = /putrajaya/i.test(info.name) ? 'Putrajaya' : /cyberjaya/i.test(info.name) ? 'Cyberjaya' : null
      for (let r = info.headerRow + 1; r < rows.length; r++) { if (rows[r].some((c) => txt(c))) push(info.name, r + 1, { ...recordFrom(info, rows, r), rawAllowanceGrade: '' }, city) }
    }
  }
  if (!leads.length) throw new ImportError('The workbook was readable but contained no organisation rows.')
  return { leads, sheets: infos, warnings }
}

/* ---------- file reading ---------- */

export async function readWorkbookFile(file: string): Promise<{ sheets: Sheets; sha256: string; filename: string }> {
  const ext = path.extname(file).toLowerCase()
  if (ext !== '.xlsx') throw new ImportError('Only .xlsx workbooks are supported.')
  const st = fs.statSync(file)
  if (!st.isFile()) throw new ImportError('Not a file.')
  if (st.size > MAX_FILE_BYTES) throw new ImportError('Workbook is larger than 25 MB.')
  const buf = fs.readFileSync(file)
  if (buf.subarray(0, 2).toString('latin1') !== 'PK') throw new ImportError('This file is not a valid .xlsx workbook.')
  const mod: any = await import('read-excel-file/node')
  let out: any
  try { out = await mod.default(file) } catch (e: any) { throw new ImportError(`Could not read the workbook: ${String(e?.message ?? e).slice(0, 200)}`) }
  const sheets: Sheets = {}
  for (const s of out as { sheet: string; data: Cell[][] }[]) sheets[s.sheet] = s.data
  return { sheets, sha256: createHash('sha256').update(buf).digest('hex'), filename: path.basename(file) }
}

