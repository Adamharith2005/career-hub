import { describe, it, expect } from 'vitest'
import { suitability, defaultRole, tierOf, companyRoles, type StudentFacts } from '../core/viewer/suitability.ts'
import { atlasToCatalog, isAtlas } from '../core/viewer/atlas.ts'
import type { CatalogCompany } from '../core/viewer/catalog.ts'

const dataStudent: StudentFacts = { id: 's1', specialisation: 'Data Science', degree: 'BSc', education: [{ title: 'Bachelor of Computer Science', points: ['Current CGPA: 3.60'] }],
  skills: [{ group: 'Data', items: ['Python', 'pandas', 'SQL', 'Power BI', 'scikit-learn'] }],
  projects: [{ title: 'Churn prediction', status: 'COMPLETED', stack: ['Python', 'scikit-learn', 'pandas'], points: [] }, { title: 'Sales dashboard', status: 'COMPLETED', stack: ['Power BI', 'SQL'], points: [] }], interests: ['Machine Learning'] }
const isStudent: StudentFacts = { id: 's2', specialisation: 'Information Systems', degree: 'BSc', education: [{ title: 'Bachelor of Computer Science', points: ['Current CGPA: 3.40'] }],
  skills: [{ group: 'Web', items: ['React', 'TypeScript', 'Firebase', 'SQL', 'Tailwind CSS'] }],
  projects: [{ title: 'Inventory app', status: 'COMPLETED', stack: ['React', 'Firebase'], points: [] }, { title: 'Cloud analyzer', status: 'PROPOSED', stack: ['Terraform', 'AWS'], points: ['Security'] }], interests: [] }
const co = (o: Partial<CatalogCompany> = {}): CatalogCompany => ({ id: 'x', leadId: null, name: 'Fixture Co', legalEntity: null, city: 'Cyberjaya', sector: 'NON_GOVERNMENT', classes: [], categoryLabel: null, industry: null, size: null, website: null,
  offices: [], tech: ['ANALYTICS', 'SOFTWARE'], relevance: null, roles: [], techDivision: null,
  internship: { evidence: 'REPORTED_PROGRAMME', sourceLabel: null, auditNote: null, docs: null, deadline: null, deadlineVerified: false, method: null, applicationUrl: null },
  allowance: { grade: 'A5', status: 'UNKNOWN', monthlyMin: null, monthlyMax: null, claimText: null, policyRef: false, conditions: null, benefits: null, sourceUrl: null, sourceDate: null, note: '' },
  contacts: { hrEmail: null, generalEmail: null, phone: null, careersUrl: null, contactForm: null, linkedin: null }, sources: [], lastVerified: '2026-11-01', uncertainties: [], notes: null, nextAction: null, verificationLevel: 'VERIFIED', ...o })

describe('suitability', () => {
  it('is computed per student from their own facts', () => {
    const c = co(); const a = suitability(dataStudent, c, 'DATA_ANALYTICS'), b = suitability(isStudent, c, 'DATA_ANALYTICS')
    expect(a.score).toBeGreaterThan(b.score + 15)
    const swe = co({ tech: ['FULL_STACK'] })
    expect(suitability(isStudent, swe, 'FULL_STACK').score).toBeGreaterThan(suitability(dataStudent, swe, 'FULL_STACK').score + 15)
  })
  it('changes with the selected role for the same company', () => {
    const c = co({ tech: ['ANALYTICS', 'CYBERSECURITY', 'CLOUD'] })
    const scores = (['DATA_ANALYTICS', 'CYBERSECURITY', 'CLOUD_DEVOPS'] as const).map((r) => suitability(dataStudent, c, r).score)
    expect(new Set(scores).size).toBeGreaterThan(1)
    expect(suitability(dataStudent, c, 'DATA_ANALYTICS').score).toBeGreaterThan(suitability(dataStudent, c, 'CYBERSECURITY').score)
  })
  it('dimension weights sum to 100 and points sum to the score', () => {
    const r = suitability(dataStudent, co(), 'DATA_ANALYTICS')
    expect(r.dimensions.reduce((a, d) => a + d.weight, 0)).toBe(100)
    expect(Math.abs(r.dimensions.reduce((a, d) => a + d.points, 0) - r.score)).toBeLessThan(0.6)
  })
  it('lists matched, partial and missing skills from actual evidence only', () => {
    const r = suitability(dataStudent, co(), 'DATA_ANALYTICS')
    expect(r.skills.matched.map((s) => s.key)).toEqual(expect.arrayContaining(['python', 'sql', 'bi']))
    expect(r.skills.missing.map((s) => s.key)).not.toContain('python')
    const cyber = suitability(dataStudent, co({ tech: ['CYBERSECURITY'] }), 'CYBERSECURITY')
    expect(cyber.skills.missing.map((s) => s.key)).toContain('security')
  })
  it('a proposed project counts for less than a completed one', () => {
    const base = { ...isStudent, skills: [], projects: [{ title: 'P', status: 'COMPLETED', stack: ['Terraform', 'AWS'], points: [] }] }
    const prop = { ...base, projects: [{ ...base.projects[0], status: 'PROPOSED' }] }
    const c = co({ tech: ['CLOUD'] })
    expect(suitability(base, c, 'CLOUD_DEVOPS').score).toBeGreaterThan(suitability(prop, c, 'CLOUD_DEVOPS').score)
  })
  it('unknown organisation function is neutral, marked unknown and provisional', () => {
    const r = suitability(dataStudent, co({ tech: ['OTHER_CS'], lastVerified: null, verificationLevel: 'UNVERIFIED', internship: { ...co().internship, evidence: 'UNKNOWN' } }), 'DATA_ANALYTICS')
    expect(r.dimensions.find((d) => d.key === 'function')).toMatchObject({ known: false, value: 0.4 })
    expect(r.provisional).toBe(true)
  })
  it('allowance never affects the score', () => {
    const a = suitability(dataStudent, co(), 'DATA_ANALYTICS').score
    const b = suitability(dataStudent, co({ allowance: { ...co().allowance, status: 'CONFIRMED_PAID', grade: 'A1', monthlyMin: 5000, monthlyMax: 5000 } }), 'DATA_ANALYTICS').score
    expect(b).toBe(a)
  })
  it('does not use source-reported scores', () => {
    const a = suitability(dataStudent, co(), 'DATA_ANALYTICS').score
    const b = suitability(dataStudent, co({ sourceClaims: { adamScore: 99, akifScore: 1, note: '' } }), 'DATA_ANALYTICS').score
    expect(b).toBe(a)
  })
  it('default role favours the student and what the organisation offers', () => {
    expect(defaultRole(dataStudent, co({ tech: ['ANALYTICS', 'SOFTWARE'] }))).toBe('DATA_ANALYTICS')
    expect(defaultRole(isStudent, co({ tech: ['ANALYTICS', 'FULL_STACK'] }))).toBe('FULL_STACK')
    expect(companyRoles(co({ tech: ['OTHER_CS'] }))).toEqual([])
  })
  it('tiers', () => { expect([90, 75, 55, 20].map(tierOf)).toEqual(['EXCELLENT', 'STRONG', 'MODERATE', 'LIMITED']) })
})

describe('atlas importer', () => {
  const H = ['Atlas_ID', 'Record_Origin', 'Geographic_Zone', 'Canonical_Organisation_Name', 'Legal_Entity_Parent', 'Canonical_Ownership_Type', 'Sector_Group', 'CS_Technical_Relevance', 'Relevant_CS_Internship_Roles', 'Physical_Office_Location', 'Office_Verification_Status', 'Internship_Vacancy_Status', 'Allowance_Terms_Corrected', 'Allowance_Confidence_Level', 'Official_Contact', 'Primary_Source_URL', 'Source_Last_Verified_Date', 'Research_Confidence_Overall', 'Adam_Suitability_100', 'Akif_Suitability_100', 'Reviewed_Zone', 'Reviewed_Address', 'Audit_Flags']
  const row = (o: Record<string, string>) => H.map((h) => o[h] ?? '')
  const sheets: any = {
    'Master Import': [H,
      row({ Atlas_ID: 'T-1', Geographic_Zone: 'Zone A — Cyberjaya (63000)', Reviewed_Zone: 'Zone A — Cyberjaya (63000)', Canonical_Organisation_Name: 'Fixture Analytics', Canonical_Ownership_Type: 'Multinational Corporation (MNC)', Sector_Group: 'Private, GLC, MNC & Institutional', Relevant_CS_Internship_Roles: 'Data Analyst Intern, Software Engineer Intern', Office_Verification_Status: 'V1 — Verified Physical HQ/Campus', Internship_Vacancy_Status: 'I1 — Active Current Posting (Nov 2026)', Allowance_Terms_Corrected: 'RM1,200 – RM1,800 (band)', Allowance_Confidence_Level: 'A2 — Verified Historical / Standard GLC-MNC Band', Official_Contact: 'hr@fixture.example | fixture.example/careers', Primary_Source_URL: 'https://fixture.example', Source_Last_Verified_Date: '2026-11-19', Adam_Suitability_100: '95', Akif_Suitability_100: '95', Reviewed_Address: 'Cyber 6, Cyberjaya' }),
      row({ Atlas_ID: 'T-2', Geographic_Zone: 'Zone C — IOI Resort City / Conezión Border (62502)', Canonical_Organisation_Name: 'Fixture Ministry', Canonical_Ownership_Type: 'Federal Government Ministry', Sector_Group: 'Government & Statutory Public Sector', Office_Verification_Status: 'V3 — Pending Unit / Suite Confirmation', Internship_Vacancy_Status: 'I4 — Unadvertised Direct Outreach Candidate', Allowance_Terms_Corrected: 'Up to RM900/month', Allowance_Confidence_Level: 'A4 — Policy Benchmark Only' })],
    'Missing Prior Leads': [['Employer absent from 187', 'Prior reported area', 'Candidate source', 'Why this needs investigation'], ['Dropped Co', 'Presint 15 Putrajaya', 'https://dropped.example', 'verify'], ['Fixture Analytics', 'Cyberjaya', '', 'dup']],
  }
  it('imports zones, sector, honest allowance and evidence; keeps dropped leads unverified', () => {
    expect(isAtlas(sheets)).toBe(true)
    const { catalog } = atlasToCatalog(sheets, { sourceFile: 't.xlsx' })
    const [a, b, d] = catalog.companies
    expect(catalog.companies).toHaveLength(3)
    expect(a).toMatchObject({ city: 'Cyberjaya', sector: 'NON_GOVERNMENT' }); expect(a.classes).toContain('MNC')
    expect(a.allowance).toMatchObject({ status: 'HISTORICAL', monthlyMin: 1200 }); expect(a.internship.evidence).toBe('REPORTED_PROGRAMME')
    expect(a.contacts.generalEmail).toBe('hr@fixture.example'); expect(a.contacts.careersUrl).toMatch(/^https:\/\/fixture\.example\/careers/)
    expect(b).toMatchObject({ city: 'IOI Resort City', sector: 'GOVERNMENT' }); expect(b.allowance).toMatchObject({ status: 'ESTIMATED', policyRef: true, monthlyMin: null })
    expect(b.internship.evidence).toBe('DIRECT_OUTREACH'); expect(b.verificationLevel).toBe('PROBABLE')
    expect(d).toMatchObject({ name: 'Dropped Co', city: 'Putrajaya', priorLead: true, verificationLevel: 'UNVERIFIED' })
    expect(a.sourceClaims?.adamScore).toBe(95)
  })
})
