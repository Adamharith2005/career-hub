/**
 * My Resumes: files the user uploads themselves. Nothing here generates or edits resume content.
 * Versions are immutable copies; attaching links an application to one exact version.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DB, all, get, run, id, nowIso, tx } from './db.ts'
import { sha256, writeNewFile } from './storage.ts'
import { slugify } from './domain.ts'

export const MAX_RESUME_BYTES = 10 * 1024 * 1024
export class ResumeError extends Error { constructor(m: string, public code = 'RESUME') { super(m) } }

export function sniffKind(buf: Buffer, name: string): 'pdf' | 'docx' {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.pdf' && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (ext === '.docx' && buf[0] === 0x50 && buf[1] === 0x4b) return 'docx'
  throw new ResumeError('Choose a PDF or Word (.docx) file. The file contents must match its extension.', 'BAD_FILE')
}

export interface AddInput { src: string; label?: string; resumeId?: string; note?: string }

/** Add a file as a new resume, or as the next version of an existing one. */
export function addResume(db: DB, profileId: string, dir: string, i: AddInput) {
  if (!fs.existsSync(i.src)) throw new ResumeError('That file could not be found.', 'FILE_MISSING')
  const st = fs.statSync(i.src)
  if (!st.isFile()) throw new ResumeError('Choose a file, not a folder.', 'BAD_FILE')
  if (st.size > MAX_RESUME_BYTES) throw new ResumeError('That file is larger than 10 MB.', 'TOO_BIG')
  if (st.size === 0) throw new ResumeError('That file is empty.', 'BAD_FILE')
  const buf = fs.readFileSync(i.src)
  const kind = sniffKind(buf, i.src)
  const digest = sha256(buf)
  return tx(db, () => {
    let rid = i.resumeId
    if (rid) {
      const r = get(db, 'SELECT resume_id FROM manual_resumes WHERE resume_id=? AND profile_id=?', rid, profileId)
      if (!r) throw new ResumeError('Unknown resume.', 'NOT_FOUND')
      const dup = get<any>(db, 'SELECT version_number FROM manual_resume_versions WHERE resume_id=? AND sha256=?', rid, digest)
      if (dup) throw new ResumeError(`This exact file is already saved as version ${dup.version_number}.`, 'DUPLICATE')
    } else {
      rid = id('res')
      const label = (i.label ?? '').trim() || path.basename(i.src, path.extname(i.src))
      run(db, 'INSERT INTO manual_resumes (resume_id,profile_id,label,created_at) VALUES (?,?,?,?)', rid, profileId, label, nowIso())
    }
    const n = (get<any>(db, 'SELECT COALESCE(MAX(version_number),0) n FROM manual_resume_versions WHERE resume_id=?', rid)!.n) + 1
    const base = slugify(path.basename(i.src, path.extname(i.src)), 40) || 'resume'
    const w = writeNewFile(dir, path.join(dir, `${rid}-v${String(n).padStart(2, '0')}-${base}.${kind}`), buf)
    const vid = id('rv')
    run(db, 'INSERT INTO manual_resume_versions (version_id,resume_id,profile_id,version_number,original_name,stored_path,sha256,size,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      vid, rid, profileId, n, path.basename(i.src), w.path, w.sha256, w.size, i.note?.trim() || null, nowIso())
    return { resumeId: rid!, versionId: vid, version: n }
  })
}

export type FileState = 'OK' | 'MISSING' | 'CHANGED'
export function fileState(v: { stored_path: string; sha256: string }): FileState {
  if (!fs.existsSync(v.stored_path)) return 'MISSING'
  return sha256(fs.readFileSync(v.stored_path)) === v.sha256 ? 'OK' : 'CHANGED'
}

export function listResumes(db: DB, profileId: string, includeArchived = false) {
  const rs = all<any>(db, `SELECT * FROM manual_resumes WHERE profile_id=? ${includeArchived ? '' : 'AND archived=0'} ORDER BY created_at DESC`, profileId)
  return rs.map((r) => {
    const versions = all<any>(db, 'SELECT * FROM manual_resume_versions WHERE resume_id=? AND profile_id=? ORDER BY version_number DESC', r.resume_id, profileId)
      .map((v) => ({ ...v, state: fileState(v), attachedTo: all<any>(db, 'SELECT l.application_id, a.company_name, a.role_title FROM application_resume_links l JOIN applications a ON a.application_id=l.application_id WHERE l.version_id=? AND l.profile_id=?', v.version_id, profileId) }))
    return { ...r, versions }
  })
}

export function attachResume(db: DB, profileId: string, applicationId: string, versionId: string) {
  if (!get(db, 'SELECT 1 FROM applications WHERE application_id=? AND profile_id=?', applicationId, profileId)) throw new ResumeError('Unknown application.', 'NOT_FOUND')
  const v = get<any>(db, 'SELECT * FROM manual_resume_versions WHERE version_id=? AND profile_id=?', versionId, profileId)
  if (!v) throw new ResumeError('Unknown resume version.', 'NOT_FOUND')
  if (fileState(v) !== 'OK') throw new ResumeError('That resume file is missing or has changed on disk. Re-upload it before attaching.', 'FILE_STATE')
  run(db, 'INSERT INTO application_resume_links (application_id,profile_id,version_id,attached_at) VALUES (?,?,?,?) ON CONFLICT(application_id) DO UPDATE SET version_id=excluded.version_id, attached_at=excluded.attached_at', applicationId, profileId, versionId, nowIso())
  return true
}

export function detachResume(db: DB, profileId: string, applicationId: string) {
  run(db, 'DELETE FROM application_resume_links WHERE application_id=? AND profile_id=?', applicationId, profileId)
  return true
}

export function attachedFor(db: DB, profileId: string, applicationId: string) {
  const v = get<any>(db, `SELECT v.*, r.label FROM application_resume_links l JOIN manual_resume_versions v ON v.version_id=l.version_id JOIN manual_resumes r ON r.resume_id=v.resume_id WHERE l.application_id=? AND l.profile_id=?`, applicationId, profileId)
  return v ? { ...v, state: fileState(v) } : null
}

export function archiveResume(db: DB, profileId: string, resumeId: string, archived: boolean) {
  run(db, 'UPDATE manual_resumes SET archived=? WHERE resume_id=? AND profile_id=?', archived ? 1 : 0, resumeId, profileId)
  return true
}

export function renameResume(db: DB, profileId: string, resumeId: string, label: string) {
  const l = label.trim(); if (!l) throw new ResumeError('Give the resume a name.', 'BAD_INPUT')
  run(db, 'UPDATE manual_resumes SET label=? WHERE resume_id=? AND profile_id=?', l.slice(0, 80), resumeId, profileId)
  return true
}

export function versionFile(db: DB, profileId: string, versionId: string) {
  const v = get<any>(db, 'SELECT * FROM manual_resume_versions WHERE version_id=? AND profile_id=?', versionId, profileId)
  if (!v) throw new ResumeError('Unknown resume version.', 'NOT_FOUND')
  return v as { stored_path: string; sha256: string; original_name: string }
}
