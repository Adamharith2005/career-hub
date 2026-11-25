import { describe, it, expect } from 'vitest'
import { compare, type CompareInput } from '../core/compare.ts'
const base: CompareInput = { company_id: 'a', name: 'A', role_families: [], allowance_grade: 'A5', allowance_monthly_min: null, internship_evidence: 'UNKNOWN', verification_level: 'UNVERIFIED' }
const mk = (o: Partial<CompareInput>): CompareInput => ({ ...base, ...o })
const today = new Date('2026-11-24')

describe('compare', () => {
  it('rejects fewer than 2 or more than 4', () => {
    expect(() => compare([base], 'balanced', today)).toThrow()
    expect(() => compare([base, base, base, base, base], 'balanced', today)).toThrow()
  })
  it('does not declare a winner when evidence is insufficient', () => {
    const r = compare([mk({ company_id: 'a' }), mk({ company_id: 'b', name: 'B' })], 'allowance', today)
    expect(r.winnerId).toBeNull(); expect(r.scored.every((s) => s.score == null)).toBe(true); expect(r.reason).toMatch(/Not enough/)
  })
  it('unknown allowance is excluded from the score, not treated as zero', () => {
    const r = compare([mk({ company_id: 'a', allowance_grade: 'A1', allowance_monthly_min: 1200, last_verified: '2026-11-01' }), mk({ company_id: 'b', name: 'B', last_verified: '2026-11-01' })], 'allowance', today)
    expect(r.scored[1].criteria.find((c) => c.key === 'allowance')!.value).toBeNull()
    expect(r.scored[1].score).toBeNull()
  })
  it('an unverified claim never counts as verified allowance', () => {
    const r = compare([mk({ company_id: 'a', allowance_grade: 'A3', allowance_monthly_min: 1500 }), mk({ company_id: 'b', name: 'B', allowance_grade: 'A3', allowance_monthly_min: 1500 })], 'allowance', today)
    expect(r.scored.every((s) => s.criteria.find((c) => c.key === 'allowance')!.value == null)).toBe(true)
  })
  it('names a clear winner on a stated priority and explains why', () => {
    const a = mk({ company_id: 'a', name: 'Sec Co', role_families: ['cyber', 'swe'], tech_departments: 'SOC', hr_email: 'h@x.my' })
    const b = mk({ company_id: 'b', name: 'Data Co', role_families: ['data'] })
    const r = compare([a, b], 'cyber', today)
    expect(r.winnerId).toBe('a'); expect(r.reason).toMatch(/not a prediction/)
  })
  it('close scores produce no winner', () => {
    const x = mk({ company_id: 'a', role_families: ['swe'], hr_email: 'a@x.my' }), y = mk({ company_id: 'b', name: 'B', role_families: ['swe'], hr_email: 'b@x.my' })
    expect(compare([x, y], 'swe', today).winnerId).toBeNull()
  })
})
