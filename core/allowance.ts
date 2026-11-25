import { DB, all, get, run, id, nowIso } from './db.ts'

export const GRADE_LABEL: Record<string, string> = {
  A1: 'Current verified', A2: 'Historical verified', A3: 'Third-party reported', A4: 'Estimated', A5: 'Not confirmed', A6: 'Confirmed unpaid',
}

/** General government policy. A reference only — it never proves what a specific department pays. */
export const JPA_POLICY = {
  policy_id: 'jpa-industrial-training-2019',
  name: 'JPA industrial training allowance', authority: 'Jabatan Perkhidmatan Awam (JPA)',
  rate_amount: 5, rate_unit: 'HOUR', hours_per_day: 8, max_paid_days: 90, effective_date: '2019-09-06',
  source_url: 'https://docs.jpa.gov.my/docs/se/2019/faq_se06092019.pdf', source_checked: '2026-11-24',
  caveats: 'RM5 per hour for up to 8 hours per paid weekday, at most 90 paid working days. Subject to each agency\'s budget; some departments publish no allowance. There is no universal monthly cap.',
}

export function ensurePolicies(db: DB) {
  const p = JPA_POLICY
  run(db, `INSERT OR IGNORE INTO gov_allowance_policies (policy_id,name,authority,rate_amount,rate_unit,hours_per_day,max_paid_days,effective_date,source_url,source_checked,caveats)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`, p.policy_id, p.name, p.authority, p.rate_amount, p.rate_unit, p.hours_per_day, p.max_paid_days, p.effective_date, p.source_url, p.source_checked, p.caveats)
}

/** Illustrative monthly figure from an hourly policy. The working-day count is always returned so the UI can show it. */
export function illustrateMonthly(policy: { rate_amount: number; hours_per_day: number | null }, paidDays: number) {
  if (!Number.isInteger(paidDays) || paidDays < 1 || paidDays > 31) throw new Error('paidDays must be 1–31')
  const hours = policy.hours_per_day ?? 8
  return { paidDays, hours, amount: policy.rate_amount * hours * paidDays, illustrative: true as const }
}

export interface AllowanceView {
  grade: string; label: string; gradeKnown: boolean
  /** Only set for A1–A4 evidence with a stated amount. Null means "not confirmed", never zero. */
  monthly: { min: number; max: number } | null
  claimText: string | null; policy: typeof JPA_POLICY | null; unpaid: boolean
  conditions: string | null; benefits: string | null; evidenceUrl: string | null; sourceDate: string | null; verifiedAt: string | null
  note: string | null; staleDays: number | null
  nextStep: string | null
}

export function allowanceFor(db: DB, companyId: string, today = new Date()): AllowanceView {
  const rows = all<any>(db, 'SELECT * FROM allowance_evidence WHERE company_id = ?', companyId)
  const order = ['A1', 'A6', 'A2', 'A3', 'A4', 'A5']
  const best = rows.sort((a, b) => order.indexOf(a.grade) - order.indexOf(b.grade))[0]
  const policy = rows.some((r) => r.policy_ref) ? get<any>(db, 'SELECT * FROM gov_allowance_policies LIMIT 1') ?? null : null
  if (!best) return { grade: 'A5', label: GRADE_LABEL.A5, gradeKnown: false, monthly: null, claimText: null, policy: null, unpaid: false, conditions: null, benefits: null, evidenceUrl: null, sourceDate: null, verifiedAt: null, note: null, staleDays: null, nextStep: 'Ask the employer directly.' }
  const when = best.verified_at ?? best.source_date
  const stale = when ? Math.floor((today.getTime() - new Date(when).getTime()) / 86400000) : null
  const hasAmount = best.monthly_min != null && ['A1', 'A2', 'A3', 'A4'].includes(best.grade)
  return {
    grade: best.grade, label: GRADE_LABEL[best.grade], gradeKnown: best.grade !== 'A5',
    monthly: hasAmount ? { min: best.monthly_min, max: best.monthly_max ?? best.monthly_min } : null,
    claimText: best.claim_text, policy, unpaid: best.grade === 'A6',
    conditions: best.conditions, benefits: best.benefits, evidenceUrl: best.evidence_url, sourceDate: best.source_date, verifiedAt: best.verified_at, note: best.note, staleDays: stale,
    nextStep: best.grade === 'A5' ? 'Allowance not confirmed. Ask the employer what the allowance is, how many days are paid, and any conditions.' : best.grade === 'A6' ? 'Official page says no allowance. Reconfirm before applying.' : null,
  }
}

/** Private to one profile. Never touches shared evidence. */
export function recordOffer(db: DB, profileId: string, o: { applicationId?: string | null; companyId?: string | null; amount: number | null; unit?: 'MONTH' | 'DAY' | 'HOUR'; conditions?: string; benefits?: string; offeredOn?: string }) {
  if (o.amount != null && (!Number.isFinite(o.amount) || o.amount < 0)) throw new Error('Amount must be a number of RM, or empty if the offer has no stated amount.')
  if (o.applicationId && !get(db, 'SELECT 1 FROM applications WHERE application_id = ? AND profile_id = ?', o.applicationId, profileId)) throw new Error('Unknown application')
  const offerId = id('off')
  run(db, `INSERT INTO personal_allowance_offers (offer_id,profile_id,application_id,company_id,amount,unit,conditions,benefits,offered_on,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    offerId, profileId, o.applicationId ?? null, o.companyId ?? null, o.amount, o.unit ?? 'MONTH', o.conditions ?? null, o.benefits ?? null, o.offeredOn ?? null, nowIso())
  return offerId
}

export const listOffers = (db: DB, profileId: string, companyId?: string) =>
  all<any>(db, `SELECT * FROM personal_allowance_offers WHERE profile_id = ? ${companyId ? 'AND company_id = ?' : ''} ORDER BY created_at DESC`, ...(companyId ? [profileId, companyId] : [profileId]))
