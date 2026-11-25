import { describe, it, expect } from 'vitest'
import { classifyOrg, classifyAllowance, normalizeOrgKey, internshipEvidenceFrom } from '../core/research-classify.ts'

describe('classifyOrg', () => {
  it('treats ministries, departments, commissions and statutory bodies as government', () => {
    expect(classifyOrg('Federal Government Ministry')).toMatchObject({ sector: 'GOVERNMENT', classes: ['MINISTRY'] })
    expect(classifyOrg('Federal Government Department (KPKM)').classes).toContain('DEPARTMENT')
    expect(classifyOrg('Constitutional Commission')).toMatchObject({ sector: 'GOVERNMENT' })
    expect(classifyOrg('Federal Statutory Body (GLIC)')).toMatchObject({ sector: 'GOVERNMENT' })
    expect(classifyOrg('Public Healthcare Institution (KKM)').sector).toBe('GOVERNMENT')
    expect(classifyOrg('Government Research Institute (KBS)').sector).toBe('GOVERNMENT')
  })
  it('never treats a GLC as a ministry; GLC / PLC overlaps', () => {
    const glc = classifyOrg('GLC')
    expect(glc.sector).toBe('NON_GOVERNMENT')
    expect(glc.classes).toEqual(['GLC'])
    const both = classifyOrg('GLC / PLC')
    expect(both.sector).toBe('NON_GOVERNMENT')
    expect(both.classes).toEqual(expect.arrayContaining(['GLC', 'PLC']))
    expect(both.classes).not.toContain('MINISTRY')
  })
  it('keeps sector separate from ownership for GLIC-linked agencies', () => {
    expect(classifyOrg('Government Agency (GLIC-linked)').sector).toBe('GOVERNMENT')
    expect(classifyOrg('GLC / GLIC-Owned')).toMatchObject({ sector: 'NON_GOVERNMENT', classes: ['GLC'] })
    expect(classifyOrg('Government-Owned Company (CLBG)').sector).toBe('NON_GOVERNMENT')
  })
  it('classifies private, MNC, PLC and universities', () => {
    expect(classifyOrg('MNC').classes).toEqual(['MNC'])
    expect(classifyOrg('MNC (JV: Hitachi Systems & Sunway)').classes).toContain('MNC')
    expect(classifyOrg('PLC (Public-Listed)').classes).toEqual(['PLC'])
    expect(classifyOrg('Private Malaysian Company').classes).toEqual(['PRIVATE'])
    expect(classifyOrg('Private International University')).toMatchObject({ sector: 'NON_GOVERNMENT' })
    expect(classifyOrg('Private International University').classes).toContain('UNIVERSITY_RESEARCH')
    expect(classifyOrg('University / Research Institution').classes).toContain('UNIVERSITY_RESEARCH')
  })
  it('does not guess for unrecognised text', () => {
    expect(classifyOrg('Something odd')).toMatchObject({ sector: 'UNKNOWN', classes: [] })
    expect(classifyOrg('')).toMatchObject({ sector: 'UNKNOWN' })
  })
})

describe('classifyAllowance — unknown is never RM0, policy is not employer-specific', () => {
  it('JPA policy wording is a GOVERNMENT_POLICY reference, not A1', () => {
    const r = classifyAllowance({ auditStatus: 'JPA policy potentially applicable; agency-specific payout unverified', originalClaim: 'Up to RM5.00/hr (Max RM900/month)', rawGrade: 'A1 — Verified Current Policy (Subject to Budget)' })
    expect(r.grade).toBe('A5')
    expect(r.policyRef).toBe(true)
    expect(r.amountMin).toBeNull()
    expect(r.claimText).toMatch(/RM5\.00/)
  })
  it('agency page saying unpaid → A6', () => {
    const r = classifyAllowance({ auditStatus: 'AGENCY PAGE SAYS UNPAID — reconfirm', originalClaim: 'RM800 – RM900', rawGrade: 'A1' })
    expect(r.grade).toBe('A6')
    expect(r.amountMin).toBeNull()
  })
  it('unsupported original claim is preserved as claim, grade A5, no amount', () => {
    const r = classifyAllowance({ auditStatus: 'UNKNOWN — original allowance claim unsupported', originalClaim: 'RM1,000 – RM1,200', rawGrade: 'A3 — Reported / Third-Party Allowance' })
    expect(r.grade).toBe('A5')
    expect(r.amountMin).toBeNull()
    expect(r.claimText).toBe('RM1,000 – RM1,200')
  })
  it('"UNKNOWN — not researched" and "Not provided" give A5 with no amount', () => {
    const r = classifyAllowance({ auditStatus: 'UNKNOWN — not researched for Cyberjaya', originalClaim: 'Not provided', rawGrade: null })
    expect(r).toMatchObject({ grade: 'A5', amountMin: null, amountMax: null, claimText: null })
  })
  it('employer-verified grades pass through when the audit status does not downgrade them', () => {
    const r = classifyAllowance({ auditStatus: 'VERIFIED — employer page', originalClaim: 'RM1,000', rawGrade: 'A1 — Current Verified' })
    expect(r.grade).toBe('A1')
    expect(r.amountMin).toBe(1000)
  })
})

describe('helpers', () => {
  it('normalizeOrgKey strips legal suffixes and brackets', () => {
    expect(normalizeOrgKey('Deriv Services Sdn Bhd')).toBe(normalizeOrgKey('deriv services'))
    expect(normalizeOrgKey('Kementerian Digital (KD)')).toBe(normalizeOrgKey('Kementerian Digital'))
  })
  it('internshipEvidenceFrom maps raw I-codes and audit text conservatively', () => {
    expect(internshipEvidenceFrom({ raw: 'I2 — Confirmed Internship Programme', audit: 'NOT INDEPENDENTLY CHECKED — source workbook status not accepted as proof' })).toBe('UNKNOWN')
    expect(internshipEvidenceFrom({ raw: 'I2', audit: 'OFFICIAL — internship process published' })).toBe('CONFIRMED_PROGRAMME')
    expect(internshipEvidenceFrom({ raw: 'I3', audit: 'NOT CHECKED — acceptance unconfirmed' })).toBe('HISTORICAL')
    expect(internshipEvidenceFrom({ raw: 'I4 — Unadvertised Direct Outreach Candidate', audit: 'NOT CHECKED' })).toBe('DIRECT_OUTREACH')
  })
})
