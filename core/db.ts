import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

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

export function openDb(file: string): DB {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
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
