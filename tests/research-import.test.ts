import { describe, it, expect } from 'vitest'
import { openDb, all, get, run, MIGRATIONS } from '../core/db.ts'
import { importSeedRows, rowsToSeed, parseDelimited } from '../core/companies.ts'
import { parseLeads, planImport, applyImport, ImportError, type Sheets, type Cell } from '../core/research-import.ts'
import fs from 'node:fs'
import path from 'node:path'

const HEAD = ['Lead ID', 'Location', 'Organisation', 'Ownership / Type', 'CS Relevance (original)', 'Potential CS Roles (original)', 'Office Address (source claim or correction)',
  'Office Verification Status (AUDIT)', 'Internship Acceptance Evidence (AUDIT)', 'Allowance Evidence Status (AUDIT)', 'Allowance Guidance (NOT a confirmed offer)',
  'Original Allowance Claim — UNVERIFIED', 'Official Website (source)', 'Careers / Application Link', 'Contact (check validity)', 'Original Suitability Score',
  'Independent Verification URL', 'Audit Checked', 'Notes / Qualifications', 'Original Source Row']

const lead = (o: Partial<Record<string, Cell>>): Cell[] => HEAD.map((h) => (h in o ? o[h] : null) as Cell)
const sheetsOf = (...rows: Cell[][]): Sheets => ({ 'ALL LEADS': [['TITLE'], [], [], HEAD, ...rows] })

const gov = lead({ 'Lead ID': 'PJ-001', Location: 'Putrajaya', Organisation: 'Kementerian Digital', 'Ownership / Type': 'Federal Government Ministry', 'CS Relevance (original)': 'Highly Relevant — Core CS',
  'Office Address (source claim or correction)': 'Presint 2, 62000 Putrajaya', 'Office Verification Status (AUDIT)': 'NOT INDEPENDENTLY CHECKED — source workbook claims VERIFIED',
  'Internship Acceptance Evidence (AUDIT)': 'NOT INDEPENDENTLY CHECKED — source', 'Allowance Evidence Status (AUDIT)': 'JPA policy potentially applicable; agency-specific payout unverified',
  'Original Allowance Claim — UNVERIFIED': 'Up to RM5.00/hr (Max RM900/month)', 'Official Website (source)': 'https://www.digital.gov.my', 'Independent Verification URL': 'https://docs.jpa.gov.my/faq.pdf' })
const glc = lead({ 'Lead ID': 'PJ-002', Location: 'Putrajaya', Organisation: 'Putrajaya Holdings Sdn Bhd', 'Ownership / Type': 'GLC', 'Allowance Evidence Status (AUDIT)': 'UNKNOWN — no employer-specific allowance verified',
  'Original Allowance Claim — UNVERIFIED': 'RM1,000 – RM1,200' })
const cj = lead({ 'Lead ID': 'CY-001', Location: 'Cyberjaya', Organisation: 'Deriv Services', 'Ownership / Type': 'MNC', 'Allowance Evidence Status (AUDIT)': 'UNKNOWN — not researched for Cyberjaya',
  'Original Allowance Claim — UNVERIFIED': 'Not provided', 'Official Website (source)': 'https://deriv.com' })

const meta = (n = 'a.xlsx') => ({ filename: n, sha256: `sha-${n}` })

describe('research import', () => {
  it('classifies government vs GLC and never invents allowance amounts', () => {
    const db = openDb(':memory:')
    applyImport(db, parseLeads(sheetsOf(gov, glc, cj)), meta())
    const k = get<any>(db, "SELECT * FROM companies WHERE name = 'Kementerian Digital'")
    expect(k).toMatchObject({ sector_group: 'GOVERNMENT', city: 'Putrajaya', verification_level: 'UNVERIFIED', internship_evidence: 'UNKNOWN' })
    expect(JSON.parse(k.classes_json)).toEqual(['MINISTRY'])
    const p = get<any>(db, "SELECT * FROM companies WHERE name = 'Putrajaya Holdings Sdn Bhd'")
    expect(p.sector_group).toBe('NON_GOVERNMENT'); expect(JSON.parse(p.classes_json)).toEqual(['GLC'])
    const a = all<any>(db, 'SELECT e.*, c.name FROM allowance_evidence e JOIN companies c USING (company_id)')
    expect(a).toHaveLength(3)
    for (const r of a) { expect(r.grade).toBe('A5'); expect(r.amount_min).toBeNull(); expect(r.monthly_min).toBeNull() }
    expect(a.find((r) => r.name === 'Kementerian Digital').policy_ref).toBe(1)
    expect(a.find((r) => r.name === 'Putrajaya Holdings Sdn Bhd').claim_text).toBe('RM1,000 – RM1,200')   // kept as claim, not as amount
    expect(a.find((r) => r.name === 'Deriv Services').claim_text).toBeNull()
  })

  it('is idempotent: same file twice, and a re-saved copy with a new hash', () => {
    const db = openDb(':memory:')
    const parsed = parseLeads(sheetsOf(gov, glc, cj))
    const r1 = applyImport(db, parsed, meta('a.xlsx'))
    expect(r1.counts.NEW).toBe(3)
    expect(applyImport(db, parsed, meta('a.xlsx')).alreadyImported).toBe(true)
    const r3 = applyImport(db, parsed, meta('b.xlsx'))
    expect(r3.counts).toMatchObject({ NEW: 0, UNCHANGED: 3, CHANGED: 0 })
    expect(get<any>(db, 'SELECT COUNT(*) n FROM companies')!.n).toBe(3)
    expect(get<any>(db, 'SELECT COUNT(*) n FROM allowance_evidence')!.n).toBe(3)
    expect(get<any>(db, 'SELECT COUNT(*) n FROM research_sources')!.n).toBe(1)   // only URL-backed sources are stored; no duplicates on re-import
  })

  it('merges into existing seed companies without duplicating or touching personal data', () => {
    const db = openDb(':memory:')
    const seed = rowsToSeed(parseDelimited(fs.readFileSync(path.resolve('data/cyberjaya-seed.tsv'), 'utf8')))
    importSeedRows(db, seed)
    const deriv = get<any>(db, "SELECT company_id FROM companies WHERE name = 'Deriv Services'")!
    run(db, "INSERT INTO profiles (profile_id,name,slug,created_at,updated_at) VALUES ('p1','Adam','adam','x','x')")
    run(db, "INSERT INTO shortlist (profile_id, company_id, created_at) VALUES ('p1', ?, 'x')", deriv.company_id)
    run(db, "INSERT INTO company_notes (profile_id, company_id, note, updated_at) VALUES ('p1', ?, 'my private note', 'x')", deriv.company_id)
    const before = get<any>(db, 'SELECT COUNT(*) n FROM companies')!.n
    const rep = applyImport(db, parseLeads(sheetsOf(cj)), meta())
    expect(rep.counts.CHANGED + rep.counts.UNCHANGED).toBe(1)
    expect(get<any>(db, 'SELECT COUNT(*) n FROM companies')!.n).toBe(before)
    const after = get<any>(db, 'SELECT * FROM companies WHERE company_id = ?', deriv.company_id)
    expect(after).toMatchObject({ city: 'Cyberjaya', sector_group: 'NON_GOVERNMENT' })
    expect(after.org_key).toBeTruthy()
    expect(get<any>(db, 'SELECT note FROM company_notes WHERE company_id = ?', deriv.company_id)!.note).toBe('my private note')
    expect(get<any>(db, 'SELECT COUNT(*) n FROM shortlist WHERE company_id = ?', deriv.company_id)!.n).toBe(1)
  })

  it('never blanks existing data from a sparser re-import, and flags downgrades as conflicts', () => {
    const db = openDb(':memory:')
    const rich = lead({ ...Object.fromEntries(HEAD.map((h, i) => [h, gov[i]])), 'Office Verification Status (AUDIT)': 'OFFICIAL — Putrajaya address confirmed', 'Contact (check validity)': 'hr@digital.gov.my' })
    applyImport(db, parseLeads(sheetsOf(rich)), meta('a.xlsx'))
    expect(get<any>(db, 'SELECT verification_level, general_contact FROM companies')).toMatchObject({ verification_level: 'VERIFIED', general_contact: 'hr@digital.gov.my' })
    const sparse = lead({ ...Object.fromEntries(HEAD.map((h, i) => [h, gov[i]])) })   // office back to "not checked", no contact
    const plan = planImport(db, parseLeads(sheetsOf(sparse)))
    expect(plan.rows[0].outcome).toBe('CONFLICT')
    expect(plan.rows[0].conflicts).toContain('verification_level')
    applyImport(db, parseLeads(sheetsOf(sparse)), meta('b.xlsx'))
    expect(get<any>(db, 'SELECT verification_level, general_contact FROM companies')).toMatchObject({ verification_level: 'VERIFIED', general_contact: 'hr@digital.gov.my' })
    expect(get<any>(db, "SELECT COUNT(*) n FROM import_rows WHERE outcome = 'CONFLICT'")!.n).toBe(1)
  })

  it('same organisation in two cities becomes one company with two offices', () => {
    const db = openDb(':memory:')
    const a = lead({ 'Lead ID': 'CY-9', Location: 'Cyberjaya', Organisation: 'Acme Tech Sdn Bhd', 'Ownership / Type': 'MNC', 'Office Address (source claim or correction)': 'Cyber 1, 63000 Cyberjaya' })
    const b = lead({ 'Lead ID': 'PJ-9', Location: 'Putrajaya', Organisation: 'Acme Tech', 'Ownership / Type': 'MNC', 'Office Address (source claim or correction)': 'Presint 3, 62100 Putrajaya' })
    const rep = applyImport(db, parseLeads(sheetsOf(a)), meta('a.xlsx'))
    expect(rep.counts.NEW).toBe(1)
    const r2 = applyImport(db, parseLeads(sheetsOf(b)), meta('b.xlsx'))
    expect(r2.counts.OFFICE_ADDED).toBe(1)
    expect(get<any>(db, 'SELECT COUNT(*) n FROM companies')!.n).toBe(1)
    expect(all<any>(db, 'SELECT city FROM company_offices ORDER BY city').map((r) => r.city)).toEqual(['Cyberjaya', 'Putrajaya'])
  })

  it('records provenance for every row', () => {
    const db = openDb(':memory:')
    applyImport(db, parseLeads(sheetsOf(gov, cj)), meta('Research.xlsx'))
    const rows = all<any>(db, 'SELECT * FROM import_rows ORDER BY source_row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ sheet: 'ALL LEADS', source_row: 5, outcome: 'NEW' })
    expect(JSON.parse(rows[0].original_json).name).toBe('Kementerian Digital')
    expect(get<any>(db, 'SELECT filename FROM import_batches')!.filename).toBe('Research.xlsx')
  })

  it('fails safely: bad workbooks raise ImportError and nothing is written', () => {
    const db = openDb(':memory:')
    expect(() => parseLeads({ Sheet1: [['a', 'b'], [1, 2]] })).toThrow(ImportError)
    expect(() => parseLeads(sheetsOf())).toThrow(/no organisation rows/)
    expect(get<any>(db, 'SELECT COUNT(*) n FROM companies')!.n).toBe(0)
  })

  it('is atomic: a failure mid-import rolls everything back', () => {
    const db = openDb(':memory:')
    const parsed = parseLeads(sheetsOf(gov, glc, cj))
    parsed.leads[2].allowance = { ...parsed.leads[2].allowance, grade: 'A9' as any }   // violates the CHECK constraint on the third row
    expect(() => applyImport(db, parsed, meta())).toThrow()
    expect(get<any>(db, 'SELECT COUNT(*) n FROM companies')!.n).toBe(0)
    expect(get<any>(db, 'SELECT COUNT(*) n FROM import_batches')!.n).toBe(0)
  })

  it('treats hostile cell content as inert text', () => {
    const db = openDb(':memory:')
    const evil = lead({ Location: 'Cyberjaya', Organisation: '=HYPERLINK("http://x")', 'Ownership / Type': 'MNC', 'Official Website (source)': 'javascript:alert(1)', 'Contact (check validity)': '<script>x</script>' })
    applyImport(db, parseLeads(sheetsOf(evil)), meta())
    const c = get<any>(db, 'SELECT * FROM companies')!
    expect(c.website).toBeNull()
    expect(c.name).toBe('=HYPERLINK("http://x")')       // stored verbatim as text; export layer must neutralise
  })
})

describe('migration v3', () => {
  it('upgrades a v2 database in place, keeps every row and takes a backup first', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'chm-'))
    const f = path.join(dir, 'x.db')
    const old = new DatabaseSync(f)
    old.exec('PRAGMA foreign_keys = ON'); old.exec(MIGRATIONS[0]); old.exec(MIGRATIONS[1]); old.exec('PRAGMA user_version = 2')
    old.exec(`INSERT INTO profiles (profile_id,name,slug,created_at,updated_at) VALUES ('p1','Adam','adam','x','x')`)
    old.exec(`INSERT INTO companies (company_id,name,imported_at) VALUES ('cj-x','Old Co','x')`)
    old.exec(`INSERT INTO applications (application_id,profile_id,company_id,company_name,role_title,created_at,updated_at) VALUES ('a1','p1','cj-x','Old Co','Intern','x','x')`)
    old.close()
    const db = openDb(f)
    expect((get<any>(db, 'PRAGMA user_version'))!.user_version).toBe(MIGRATIONS.length)
    expect(get<any>(db, "SELECT name, sector_group, internship_evidence FROM companies WHERE company_id = 'cj-x'")).toMatchObject({ name: 'Old Co', sector_group: 'UNKNOWN', internship_evidence: 'UNKNOWN' })
    expect(get<any>(db, "SELECT COUNT(*) n FROM applications")!.n).toBe(1)
    expect(fs.existsSync(`${f}.pre-v2-to-v${MIGRATIONS.length}.bak`)).toBe(true)
    db.close()
  })
})
