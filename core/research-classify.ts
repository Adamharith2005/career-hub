/**
 * Pure classification rules for imported research rows. No database, no I/O.
 * Principles: sector, ownership class and size are separate attributes; unknown is never zero;
 * a general government policy is never an employer-specific confirmation.
 */

export type Sector = 'GOVERNMENT' | 'NON_GOVERNMENT' | 'UNKNOWN'
export type OrgClass =
  | 'MINISTRY' | 'DEPARTMENT' | 'AGENCY' | 'STATUTORY_BODY' | 'COMMISSION' | 'PUBLIC_INSTITUTION'
  | 'GLC' | 'MNC' | 'PLC' | 'PRIVATE' | 'UNIVERSITY_RESEARCH'

export interface OrgClassification { sector: Sector; classes: OrgClass[] }

const has = (s: string, re: RegExp) => re.test(s)

export function classifyOrg(raw: string | null | undefined): OrgClassification {
  const s = (raw ?? '').trim()
  if (!s) return { sector: 'UNKNOWN', classes: [] }
  const classes: OrgClass[] = []
  const add = (c: OrgClass) => { if (!classes.includes(c)) classes.push(c) }

  // Company-form ownership first: GLC / MNC / PLC are NON_GOVERNMENT even when state-linked.
  const glc = has(s, /\bglc\b|glic-owned|government-owned company|clbg|state glc/i)
  const plc = has(s, /\bplc\b|public-listed/i)
  const mnc = has(s, /\bmnc\b/i)
  const uni = has(s, /universit|research institution/i) && !has(s, /government research/i)
  const publicBody = has(s, /ministry|department|division|commission|statutory|agency|council|judiciary|legal institution|religious institution|public healthcare|government research|foundation/i)

  if (glc) add('GLC')
  if (plc) add('PLC')
  if (mnc) add('MNC')
  if (uni) add('UNIVERSITY_RESEARCH')

  let sector: Sector = 'UNKNOWN'
  if (glc || plc || mnc || uni || has(s, /private|bank/i)) {
    // "Government Agency (GLIC-linked)" is an agency first; GLIC is a funding link, not a company form.
    if (!glc && has(s, /^government agency|^federal .*(agency|statutory|department|ministry)/i)) sector = 'GOVERNMENT'
    else sector = 'NON_GOVERNMENT'
  } else if (publicBody) sector = 'GOVERNMENT'

  if (sector === 'GOVERNMENT') {
    if (has(s, /ministry/i)) add('MINISTRY')
    if (has(s, /department|division|judiciary|legal institution|religious institution|security council/i)) add('DEPARTMENT')
    if (has(s, /commission/i)) add('COMMISSION')
    if (has(s, /statutory/i)) add('STATUTORY_BODY')
    if (has(s, /agency/i)) add('AGENCY')
    if (has(s, /healthcare|research institute|foundation/i)) add('PUBLIC_INSTITUTION')
    if (!classes.length) add('PUBLIC_INSTITUTION')
  } else if (sector === 'NON_GOVERNMENT') {
    if (has(s, /private/i) && !classes.length) add('PRIVATE')
    if (!classes.length) add('PRIVATE')
  }
  return { sector, classes }
}

export type AllowanceGrade = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6'

export interface AllowanceClass {
  grade: AllowanceGrade
  /** Amount in RM per month where the source states one AND the grade supports displaying it; otherwise null (never 0). */
  amountMin: number | null
  amountMax: number | null
  /** General-government policy reference (JPA rate). Stored apart from employer-specific evidence. */
  policyRef: boolean
  /** The original spreadsheet claim, preserved verbatim for provenance. Not displayed as an amount unless grade supports it. */
  claimText: string | null
  note: string
}

const NONE = /^(|not provided|unknown|n\/a|-)$/i

export function parseRmRange(text: string | null | undefined): { min: number | null; max: number | null } {
  const nums = [...(text ?? '').replace(/,/g, '').matchAll(/RM\s*(\d+(?:\.\d+)?)/gi)].map((m) => Number(m[1]))
  if (!nums.length) return { min: null, max: null }
  return { min: Math.min(...nums), max: Math.max(...nums) }
}

export function classifyAllowance(i: { auditStatus: string | null; originalClaim: string | null; rawGrade: string | null }): AllowanceClass {
  const audit = (i.auditStatus ?? '').trim()
  const claim = (i.originalClaim ?? '').trim()
  const claimText = NONE.test(claim) ? null : claim
  const base = { amountMin: null, amountMax: null, policyRef: false, claimText }

  if (/says unpaid|no allowance|unpaid/i.test(audit))
    return { ...base, grade: 'A6', note: 'Official agency page states no allowance. Reconfirm against current JPA guidance before relying on it.' }
  if (/jpa policy/i.test(audit))
    return { ...base, grade: 'A5', policyRef: true, note: 'General government policy may apply. This organisation has not confirmed what it actually pays.' }
  if (/^unknown|unsupported|not researched/i.test(audit) || !audit && !i.rawGrade)
    return { ...base, grade: 'A5', note: claimText ? 'The original spreadsheet claim is unsupported by evidence and is kept for reference only.' : 'No reliable amount established.' }

  // Not downgraded by the audit: honour the stated evidence grade, but only show an amount when the grade supports one.
  const g = /^A([1-6])/i.exec(i.rawGrade ?? '')
  const grade = (g ? `A${g[1]}` : 'A5') as AllowanceGrade
  const { min, max } = parseRmRange(claimText)
  const shows = (grade === 'A1' || grade === 'A2' || grade === 'A3' || grade === 'A4') && min != null
  return { grade, amountMin: shows ? min : null, amountMax: shows ? max : null, policyRef: false, claimText, note: `Source grade ${grade}.` }
}

/** Stable key for matching the same organisation across imports and sheets. */
export function normalizeOrgKey(name: string): string {
  return name.toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(sdn\.?|bhd\.?|berhad|plc|the|malaysia|\(m\))\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

export type InternshipEvidence = 'ACTIVE_OPENING' | 'CONFIRMED_PROGRAMME' | 'REPORTED_PROGRAMME' | 'HISTORICAL' | 'DIRECT_OUTREACH' | 'UNKNOWN' | 'NOT_ACCEPTING'

/** Conservative: a spreadsheet label alone never confirms a programme. The audit text decides. */
export function internshipEvidenceFrom(i: { raw: string | null; audit: string | null }): InternshipEvidence {
  const raw = (i.raw ?? '').trim()
  const audit = (i.audit ?? '').trim()
  if (/not accepting/i.test(audit)) return 'NOT_ACCEPTING'
  if (/^official/i.test(audit)) return 'CONFIRMED_PROGRAMME'
  if (/^I4\b|^D\b/i.test(raw)) return 'DIRECT_OUTREACH'
  if (/^I3\b/i.test(raw)) return 'HISTORICAL'
  return 'UNKNOWN'
}
