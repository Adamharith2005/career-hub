import { describe, it, expect } from 'vitest'
import { openDb, run, get, all } from '../core/db.ts'
import { ensurePolicies, JPA_POLICY, illustrateMonthly, allowanceFor, recordOffer, listOffers } from '../core/allowance.ts'

const setup = () => {
  const db = openDb(':memory:')
  ensurePolicies(db)
  run(db, `INSERT INTO companies (company_id,name,imported_at) VALUES ('c1','Acme','x'),('c2','Beta','x'),('c3','Gamma','x')`)
  run(db, `INSERT INTO profiles (profile_id,name,slug,created_at,updated_at) VALUES ('adam','Adam','adam','x','x'),('akif','Akif','akif','x','x')`)
  return db
}
const ev = (db: any, cid: string, o: Record<string, any>) => run(db, `INSERT INTO allowance_evidence (allowance_id,company_id,grade,monthly_min,monthly_max,claim_text,policy_ref,evidence_url,verified_at,note) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  `al-${cid}`, cid, o.grade, o.min ?? null, o.max ?? null, o.claim ?? null, o.policy ?? 0, o.url ?? null, o.verified ?? null, o.note ?? null)

describe('allowance intelligence', () => {
  it('no evidence → not confirmed, monthly is null (never 0)', () => {
    const v = allowanceFor(setup(), 'c1')
    expect(v.grade).toBe('A5'); expect(v.monthly).toBeNull(); expect(v.nextStep).toMatch(/Ask the employer/)
  })
  it('A5 with a claim keeps the claim as text, not an amount', () => {
    const db = setup(); ev(db, 'c1', { grade: 'A5', claim: 'RM1,000 – RM1,200' })
    const v = allowanceFor(db, 'c1'); expect(v.monthly).toBeNull(); expect(v.claimText).toBe('RM1,000 – RM1,200'); expect(v.gradeKnown).toBe(false)
  })
  it('government policy is a separate reference, not employer confirmation', () => {
    const db = setup(); ev(db, 'c1', { grade: 'A5', policy: 1 })
    const v = allowanceFor(db, 'c1'); expect(v.policy?.rate_amount).toBe(5); expect(v.grade).toBe('A5'); expect(v.monthly).toBeNull()
  })
  it('historical stays historical and shows its own age', () => {
    const db = setup(); ev(db, 'c2', { grade: 'A2', min: 800, max: 900, verified: '2024-01-01' })
    const v = allowanceFor(db, 'c2', new Date('2026-01-01'))
    expect(v.grade).toBe('A2'); expect(v.label).toBe('Historical verified'); expect(v.monthly).toEqual({ min: 800, max: 900 }); expect(v.staleDays).toBeGreaterThan(700)
  })
  it('confirmed unpaid is not zero', () => {
    const db = setup(); ev(db, 'c3', { grade: 'A6' })
    const v = allowanceFor(db, 'c3'); expect(v.unpaid).toBe(true); expect(v.monthly).toBeNull()
  })
  it('an amount on an A5/A6 row is never surfaced', () => {
    const db = setup(); ev(db, 'c1', { grade: 'A5', min: 500, max: 500 })
    expect(allowanceFor(db, 'c1').monthly).toBeNull()
  })
  it('monthly illustration shows its working-day count and is flagged illustrative', () => {
    const r = illustrateMonthly(JPA_POLICY, 20)
    expect(r).toEqual({ paidDays: 20, hours: 8, amount: 800, illustrative: true })
    expect(() => illustrateMonthly(JPA_POLICY, 0)).toThrow()
  })
  it('personal offers are private and never change shared evidence', () => {
    const db = setup(); ev(db, 'c1', { grade: 'A5' })
    recordOffer(db, 'adam', { companyId: 'c1', amount: 1200 })
    expect(listOffers(db, 'adam')).toHaveLength(1)
    expect(listOffers(db, 'akif')).toHaveLength(0)
    expect(allowanceFor(db, 'c1').monthly).toBeNull()
    expect(get<any>(db, "SELECT grade FROM allowance_evidence WHERE company_id='c1'")!.grade).toBe('A5')
    expect(() => recordOffer(db, 'adam', { companyId: 'c1', amount: -5 })).toThrow()
    expect(all(db, 'SELECT 1 FROM personal_allowance_offers')).toHaveLength(1)
  })
  it('an offer cannot attach to another profile\'s application', () => {
    const db = setup()
    run(db, `INSERT INTO applications (application_id,profile_id,company_name,role_title,created_at,updated_at) VALUES ('ap1','akif','Acme','Intern','x','x')`)
    expect(() => recordOffer(db, 'adam', { applicationId: 'ap1', amount: 900 })).toThrow(/Unknown application/)
  })
})
