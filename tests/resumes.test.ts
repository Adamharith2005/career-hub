import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb, run, get, all } from '../core/db.ts'
import { addResume, listResumes, attachResume, detachResume, attachedFor, fileState, archiveResume } from '../core/resumes.ts'

let dir: string, db: ReturnType<typeof openDb>
const pdf = (name: string, body = 'x') => { const f = path.join(dir, name); fs.writeFileSync(f, `%PDF-1.4\n${body}`); return f }
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'res-'))
  db = openDb(':memory:')
  run(db, `INSERT INTO profiles (profile_id,name,slug,created_at,updated_at) VALUES ('adam','Adam','adam','x','x'),('akif','Akif','akif','x','x')`)
  run(db, `INSERT INTO applications (application_id,profile_id,company_name,role_title,created_at,updated_at) VALUES ('ap1','adam','Acme','Intern','x','x'),('ap2','akif','Beta','Intern','x','x')`)
})

describe('My Resumes', () => {
  it('stores an upload byte-for-byte as version 1, then versions on re-add', () => {
    const a = addResume(db, 'adam', path.join(dir, 'store'), { src: pdf('cv.pdf', 'one'), label: 'General' })
    expect(a.version).toBe(1)
    const b = addResume(db, 'adam', path.join(dir, 'store'), { src: pdf('cv2.pdf', 'two'), resumeId: a.resumeId })
    expect(b.version).toBe(2)
    const [r] = listResumes(db, 'adam')
    expect(r.versions.map((v: any) => v.version_number)).toEqual([2, 1])
    expect(fs.readFileSync(r.versions[1].stored_path, 'utf8')).toBe('%PDF-1.4\none')
  })
  it('rejects wrong type, spoofed extension, empty, and duplicate content', () => {
    const s = path.join(dir, 'store')
    const exe = path.join(dir, 'a.exe'); fs.writeFileSync(exe, 'MZ'); expect(() => addResume(db, 'adam', s, { src: exe })).toThrow(/PDF or Word/)
    const fake = path.join(dir, 'fake.pdf'); fs.writeFileSync(fake, 'not a pdf'); expect(() => addResume(db, 'adam', s, { src: fake })).toThrow(/PDF or Word/)
    const empty = path.join(dir, 'e.pdf'); fs.writeFileSync(empty, ''); expect(() => addResume(db, 'adam', s, { src: empty })).toThrow(/empty/)
    const a = addResume(db, 'adam', s, { src: pdf('c.pdf', 'same') })
    expect(() => addResume(db, 'adam', s, { src: pdf('c2.pdf', 'same'), resumeId: a.resumeId })).toThrow(/already saved/)
  })
  it('profiles are isolated', () => {
    const s = path.join(dir, 'store')
    const a = addResume(db, 'adam', s, { src: pdf('c.pdf') })
    expect(listResumes(db, 'akif')).toHaveLength(0)
    expect(() => addResume(db, 'akif', s, { src: pdf('d.pdf', 'd'), resumeId: a.resumeId })).toThrow(/Unknown/)
    expect(() => attachResume(db, 'akif', 'ap2', a.versionId)).toThrow(/Unknown/)
    expect(() => attachResume(db, 'adam', 'ap2', a.versionId)).toThrow(/Unknown application/)
  })
  it('attach pins one exact version; re-attach switches; detach clears', () => {
    const s = path.join(dir, 'store')
    const a = addResume(db, 'adam', s, { src: pdf('c.pdf', '1') })
    const b = addResume(db, 'adam', s, { src: pdf('c2.pdf', '2'), resumeId: a.resumeId })
    attachResume(db, 'adam', 'ap1', a.versionId)
    expect(attachedFor(db, 'adam', 'ap1')!.version_number).toBe(1)
    attachResume(db, 'adam', 'ap1', b.versionId)
    expect(attachedFor(db, 'adam', 'ap1')!.version_number).toBe(2)
    expect(all(db, 'SELECT 1 FROM application_resume_links')).toHaveLength(1)
    detachResume(db, 'adam', 'ap1'); expect(attachedFor(db, 'adam', 'ap1')).toBeNull()
  })
  it('detects a file changed or removed on disk and refuses to attach it', () => {
    const a = addResume(db, 'adam', path.join(dir, 'store'), { src: pdf('c.pdf') })
    const v = get<any>(db, 'SELECT * FROM manual_resume_versions')!
    expect(fileState(v)).toBe('OK')
    fs.appendFileSync(v.stored_path, 'tamper'); expect(fileState(v)).toBe('CHANGED')
    expect(() => attachResume(db, 'adam', 'ap1', a.versionId)).toThrow(/missing or has changed/)
    fs.rmSync(v.stored_path); expect(fileState(v)).toBe('MISSING')
  })
  it('archiving hides but keeps versions', () => {
    const a = addResume(db, 'adam', path.join(dir, 'store'), { src: pdf('c.pdf') })
    archiveResume(db, 'adam', a.resumeId, true)
    expect(listResumes(db, 'adam')).toHaveLength(0)
    expect(listResumes(db, 'adam', true)[0].versions).toHaveLength(1)
  })
})
