import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

export type DB = DatabaseSync

export const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
export const nowIso = () => new Date().toISOString()

/** Ordered, append-only migrations. Every personal table carries profile_id. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE profiles (
    profile_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    roles_json TEXT NOT NULL DEFAULT '[]',
    primary_role TEXT,
    other_role_text TEXT,
    career_types_json TEXT NOT NULL DEFAULT '[]',
    region TEXT NOT NULL DEFAULT 'Cyberjaya',
    prefs_json TEXT NOT NULL DEFAULT '{}',
    identity_json TEXT NOT NULL DEFAULT '{}',
    storage_root TEXT,
    onboarding_step INTEGER NOT NULL DEFAULT 1,
    onboarding_done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE settings (
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (profile_id, key)
  );
  CREATE TABLE source_documents (
    doc_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('MASTER_CV','RESUME','SUPPORT')),
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    text_content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE facts (
    fact_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('EDUCATION','SKILL','PROJECT','EXPERIENCE','LEADERSHIP','CERTIFICATION','AWARD','LANGUAGE','LINK')),
    title TEXT NOT NULL,
    organization TEXT,
    date_start TEXT, date_end TEXT,
    claim_text TEXT NOT NULL DEFAULT '',
    tools_json TEXT NOT NULL DEFAULT '[]',
    metrics_json TEXT NOT NULL DEFAULT '[]',
    source_citation TEXT NOT NULL DEFAULT 'manual',
    confidence TEXT NOT NULL DEFAULT 'medium',
    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_facts_profile ON facts(profile_id);
  CREATE TABLE companies (
    company_id TEXT PRIMARY KEY,
    profile_id TEXT REFERENCES profiles(profile_id) ON DELETE CASCADE,  -- NULL = shared seed row
    seed_rank INTEGER,
    name TEXT NOT NULL,
    legal_entity TEXT, ownership_type TEXT, company_size TEXT, industry TEXT,
    cs_relevance TEXT, relevant_roles TEXT,
    role_families_json TEXT NOT NULL DEFAULT '[]',
    address TEXT, address_precision TEXT NOT NULL DEFAULT 'BUILDING_VERIFIED',
    office_status TEXT,
    status_code_raw TEXT, status_enum TEXT NOT NULL DEFAULT 'NEEDS_VERIFICATION',
    priority_tier TEXT NOT NULL DEFAULT 'T4',
    website TEXT, careers_page TEXT, hr_email TEXT, general_contact TEXT, linkedin TEXT,
    recommended_method TEXT, suitability_score INTEGER, contact_score INTEGER,
    evidence_sources TEXT, last_verified TEXT, research_notes TEXT,
    flags_json TEXT NOT NULL DEFAULT '[]',
    raw_json TEXT NOT NULL DEFAULT '{}',
    is_seed INTEGER NOT NULL DEFAULT 1,
    imported_at TEXT NOT NULL
  );
  CREATE INDEX idx_companies_name ON companies(name);
  CREATE TABLE company_notes (
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    note TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, company_id)
  );
  CREATE TABLE applications (
    application_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(company_id),
    company_name TEXT NOT NULL,
    role_title TEXT NOT NULL,
    role_family TEXT NOT NULL DEFAULT 'swe',
    career_type TEXT NOT NULL DEFAULT 'INTERNSHIP',
    mode TEXT NOT NULL DEFAULT 'ADVERTISED_VACANCY' CHECK (mode IN ('ADVERTISED_VACANCY','SPECULATIVE_OUTREACH')),
    status TEXT NOT NULL DEFAULT 'SAVED',
    location TEXT, source TEXT, job_url TEXT,
    job_text TEXT NOT NULL DEFAULT '',
    job_spec_json TEXT, assessment_json TEXT,
    compensation_json TEXT,
    contact_email TEXT,
    folder_path TEXT,
    applied_at TEXT, applied_method TEXT,
    next_action_text TEXT, next_action_due TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_apps_profile ON applications(profile_id);
  CREATE TABLE document_versions (
    doc_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('RESUME','COVER_LETTER')),
    version_number INTEGER NOT NULL,
    ast_json TEXT NOT NULL,
    changelog_json TEXT NOT NULL DEFAULT '[]',
    qa_passed INTEGER NOT NULL DEFAULT 0,
    qa_report_json TEXT,
    fact_check_json TEXT,
    pdf_path TEXT, pdf_sha256 TEXT, pdf_size INTEGER,
    docx_path TEXT, docx_sha256 TEXT, docx_size INTEGER,
    is_submitted_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE emails (
    email_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    to_addr TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL, body TEXT NOT NULL,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    eml_path TEXT, eml_sha256 TEXT,
    version_number INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE application_events (
    event_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    from_status TEXT, to_status TEXT,
    summary TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_events_app ON application_events(application_id);
  `,
  `
  -- V2: structured profile-first model. Additive only: no existing column or row is changed or dropped.
  ALTER TABLE facts ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';   -- per-category fields (project type, role, url, level, cgpa, scale, proficiency...)
  ALTER TABLE facts ADD COLUMN updated_at TEXT;
  ALTER TABLE facts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
  UPDATE facts SET updated_at = created_at WHERE updated_at IS NULL;
  ALTER TABLE source_documents ADD COLUMN fact_id TEXT;                    -- optional evidence attached to one record
  ALTER TABLE source_documents ADD COLUMN evidence_label TEXT;
  CREATE TABLE shortlist (
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, company_id)
  );
  -- Setup wizard changed from 3 to 4 steps; unfinished wizards restart at step 1 (their data is kept).
  UPDATE profiles SET onboarding_step = 1 WHERE onboarding_done = 0;
  `,
  `
  -- V3: provenance, stable profile keys, audit log, and a CV document type. Additive except the document_versions rebuild (rows copied 1:1).
  ALTER TABLE applications ADD COLUMN pack_json TEXT;                        -- snapshot of the last prepared application pack (alignment, recipient, warnings)
  ALTER TABLE emails ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;           -- 1 = the user edited this draft; regenerating documents keeps their wording
  ALTER TABLE profiles ADD COLUMN stable_key TEXT;                          -- 'adam' / 'akif': a re-import finds the same profile instead of duplicating it
  CREATE UNIQUE INDEX idx_profiles_stable ON profiles(stable_key) WHERE stable_key IS NOT NULL;
  ALTER TABLE facts ADD COLUMN status TEXT NOT NULL DEFAULT 'USER_REPORTED';  -- DOCUMENTED | USER_REPORTED | IN_PROGRESS | NEEDS_CONFIRMATION | REPO_OBSERVED
  ALTER TABLE facts ADD COLUMN source_ref TEXT;                              -- source filename / URL
  ALTER TABLE facts ADD COLUMN verified_on TEXT;
  ALTER TABLE facts ADD COLUMN user_override INTEGER NOT NULL DEFAULT 0;     -- 1 = the user edited it; a re-import never overwrites it
  ALTER TABLE facts ADD COLUMN maturity TEXT;                                -- coursework | proposal | prototype | deployed | idea ...
  ALTER TABLE facts ADD COLUMN import_key TEXT;
  CREATE UNIQUE INDEX idx_facts_import ON facts(profile_id, import_key) WHERE import_key IS NOT NULL;
  CREATE TABLE fact_log (
    log_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    fact_key TEXT NOT NULL,
    action TEXT NOT NULL,            -- IMPORT_ADD | IMPORT_UPDATE | IMPORT_SKIP_USER_EDIT | USER_EDIT
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_factlog_profile ON fact_log(profile_id);
  CREATE TABLE document_versions_v3 (
    doc_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('RESUME','COVER_LETTER','CV')),
    version_number INTEGER NOT NULL,
    ast_json TEXT NOT NULL,
    changelog_json TEXT NOT NULL DEFAULT '[]',
    qa_passed INTEGER NOT NULL DEFAULT 0,
    qa_report_json TEXT,
    fact_check_json TEXT,
    pdf_path TEXT, pdf_sha256 TEXT, pdf_size INTEGER,
    docx_path TEXT, docx_sha256 TEXT, docx_size INTEGER,
    is_submitted_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  INSERT INTO document_versions_v3 SELECT doc_id, profile_id, application_id, doc_type, version_number, ast_json, changelog_json, qa_passed, qa_report_json, fact_check_json, pdf_path, pdf_sha256, pdf_size, docx_path, docx_sha256, docx_size, is_submitted_version, created_at FROM document_versions;
  DROP TABLE document_versions;
  ALTER TABLE document_versions_v3 RENAME TO document_versions;
  `,
  `
  -- V3 (Career Hub 3.0): multi-city research intelligence. Additive only: no existing column or row is changed or dropped.
  ALTER TABLE companies ADD COLUMN city TEXT;                                   -- Cyberjaya | Putrajaya | NULL (unknown / user-added)
  ALTER TABLE companies ADD COLUMN sector_group TEXT NOT NULL DEFAULT 'UNKNOWN'; -- GOVERNMENT | NON_GOVERNMENT | UNKNOWN
  ALTER TABLE companies ADD COLUMN classes_json TEXT NOT NULL DEFAULT '[]';      -- overlapping ownership classes (GLC, PLC, MINISTRY, ...)
  ALTER TABLE companies ADD COLUMN lead_id TEXT;
  ALTER TABLE companies ADD COLUMN org_key TEXT;                                 -- normalised name for cross-import matching
  ALTER TABLE companies ADD COLUMN verification_level TEXT NOT NULL DEFAULT 'UNVERIFIED'; -- VERIFIED | PROBABLE | UNVERIFIED | HISTORICAL
  ALTER TABLE companies ADD COLUMN internship_evidence TEXT NOT NULL DEFAULT 'UNKNOWN';   -- ACTIVE_OPENING | CONFIRMED_PROGRAMME | HISTORICAL | DIRECT_OUTREACH | NOT_ACCEPTING | UNKNOWN
  ALTER TABLE companies ADD COLUMN tech_departments TEXT;
  ALTER TABLE companies ADD COLUMN deadline_text TEXT;
  ALTER TABLE companies ADD COLUMN required_docs TEXT;
  ALTER TABLE companies ADD COLUMN application_url TEXT;
  UPDATE companies SET city = 'Cyberjaya' WHERE profile_id IS NULL AND company_id LIKE 'cj-%';   -- the V1/V2 seed was Cyberjaya-only
  CREATE INDEX idx_companies_city ON companies(city);
  CREATE INDEX idx_companies_orgkey ON companies(org_key);

  CREATE TABLE company_offices (
    office_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    city TEXT NOT NULL,
    address TEXT,
    verification TEXT NOT NULL DEFAULT 'UNVERIFIED',
    verification_note TEXT,
    UNIQUE (company_id, city)
  );
  CREATE TABLE research_sources (
    source_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    url TEXT, description TEXT NOT NULL, source_date TEXT,
    confidence TEXT NOT NULL DEFAULT 'UNVERIFIED',
    supports TEXT,                                -- OFFICE | INTERNSHIP | ALLOWANCE | CONTACT | OTHER
    batch_id TEXT,
    UNIQUE (company_id, url, supports)
  );
  -- Shared, employer-specific allowance evidence. Unknown is a grade (A5), never an amount of 0.
  CREATE TABLE allowance_evidence (
    allowance_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    grade TEXT NOT NULL CHECK (grade IN ('A1','A2','A3','A4','A5','A6')),
    amount_min REAL, amount_max REAL,
    payment_unit TEXT, monthly_min REAL, monthly_max REAL,
    role TEXT, programme TEXT, conditions TEXT, benefits TEXT,
    evidence_url TEXT, source_date TEXT, verified_at TEXT,
    claim_text TEXT,                              -- original spreadsheet claim, verbatim, never shown as confirmed
    policy_ref INTEGER NOT NULL DEFAULT 0,        -- 1 = a general government policy may apply (see gov_allowance_policies)
    note TEXT,
    batch_id TEXT
  );
  CREATE INDEX idx_allow_company ON allowance_evidence(company_id);
  CREATE TABLE gov_allowance_policies (
    policy_id TEXT PRIMARY KEY,
    name TEXT NOT NULL, authority TEXT NOT NULL,
    rate_amount REAL NOT NULL, rate_unit TEXT NOT NULL,   -- HOUR | DAY | MONTH
    hours_per_day REAL, max_paid_days INTEGER,
    effective_date TEXT, source_url TEXT, source_checked TEXT,
    caveats TEXT NOT NULL
  );
  -- Private to one profile: what an employer actually offered Adam or Akif. Never modifies shared evidence.
  CREATE TABLE personal_allowance_offers (
    offer_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    application_id TEXT REFERENCES applications(application_id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(company_id) ON DELETE SET NULL,
    amount REAL, unit TEXT NOT NULL DEFAULT 'MONTH',
    conditions TEXT, benefits TEXT, offered_on TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_offers_profile ON personal_allowance_offers(profile_id);

  CREATE TABLE import_batches (
    batch_id TEXT PRIMARY KEY,
    filename TEXT NOT NULL, sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX idx_batches_sha ON import_batches(sha256);
  CREATE TABLE import_rows (
    row_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(company_id) ON DELETE SET NULL,
    sheet TEXT NOT NULL, source_row INTEGER NOT NULL,
    outcome TEXT NOT NULL,                        -- NEW | CHANGED | UNCHANGED | CONFLICT
    original_json TEXT NOT NULL,
    diff_json TEXT
  );
  CREATE INDEX idx_import_rows_batch ON import_rows(batch_id);
  `,
  // v4: My Resumes (manual upload only) + approval gate for CV Studio drafts. Additive.
  `
  CREATE TABLE manual_resumes (
    resume_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_manual_resumes_profile ON manual_resumes(profile_id);
  CREATE TABLE manual_resume_versions (
    version_id TEXT PRIMARY KEY,
    resume_id TEXT NOT NULL REFERENCES manual_resumes(resume_id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size INTEGER NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (resume_id, version_number)
  );
  CREATE TABLE application_resume_links (
    application_id TEXT PRIMARY KEY REFERENCES applications(application_id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES manual_resume_versions(version_id),
    attached_at TEXT NOT NULL
  );
  ALTER TABLE document_versions ADD COLUMN approved_at TEXT;
  `,
]

export function migrate(db: DB) {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let v = row.user_version
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    v++
  }
}

/** Copy the database aside before any pending migration touches an existing (non-empty) file. Returns the backup path, if one was made. */
export function backupBeforeMigrate(db: DB, file: string): string | null {
  const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (v === 0 || v >= MIGRATIONS.length || !fs.existsSync(file)) return null
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* best effort */ }
  const dest = `${file}.pre-v${v}-to-v${MIGRATIONS.length}.bak`
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest)
  return dest
}

export function openDb(file: string): DB {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
  backupBeforeMigrate(db, file)
  migrate(db)
  return db
}

/** Tiny helpers so call sites stay terse. */
export const all = <T = any>(db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as T[]
export const get = <T = any>(db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as T | undefined
export const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p)
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
}
