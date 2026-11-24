/**
 * Private local storage for the two profiles and their documents. Plain JSON under <userData>/viewer.
 * No database, no account system. Seeded once from a gitignored local file; never overwrites edits.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export type ProfileId = 'adam' | 'akif'
export const PROFILE_IDS: ProfileId[] = ['adam', 'akif']
export const MAX_DOC_BYTES = 10 * 1024 * 1024

export interface DocVersion { id: string; version: number; originalName: string; file: string; sha256: string; size: number; addedAt: string; note: string | null }
/** One inventory entry. Everything past `url` is optional so older profiles stay valid. `bullets` are the only lines a CV may use; each cites its evidence. */
export interface ProjectRecord {
  id?: string; title: string; context: string; date: string; status: string; stack: string[]; points: string[]; caveat: string; url: string | null
  purpose?: string; kind?: string; contribution?: 'SOLO' | 'TEAM' | 'TEAM_UNCERTAIN'; role?: string; source?: string; confidence?: 'HIGH' | 'MEDIUM' | 'LOW'
  maturity?: string; themes?: string[]; implemented?: string[]; planned?: string[]; excluded?: string[]
  bullets?: { text: string; evidence: string; themes?: string[] }[]
  /** Rank on the master resume (1 = first). Absent = not on the master, still available for tailoring. */
  master?: number | null; masterBullets?: number; additional?: string | null; additionalLabel?: string; /** Short noun phrase used in emails, e.g. "Tanda, an on-device assistive prototype". */ emailName?: string; award?: string | null
}
export interface CvVersion { id: string; n: number; createdAt: string; ast: any; note: string; source: 'generated' | 'edited' | 'restored'; status: 'DRAFT' | 'APPROVED'; approvedAt?: string; file?: string; sha256?: string; pages?: number }
export interface CvRecord { id: string; mode: 'MASTER' | 'TAILORED'; label: string; companyId?: string; companyName?: string; role?: string | null; vacancy: 'NONE' | 'GIVEN'; versions: CvVersion[] }
export interface DocEntry { id: string; label: string; kind: 'CV' | 'RESUME'; archived: boolean; versions: DocVersion[] }
export interface Profile {
  id: ProfileId; displayName: string; fullName: string; specialisation: string; university: string; degree: string
  contact: { email: string; phone: string; location: string }; links: { label: string; url: string }[]
  headline: string; summary: string
  education: { title: string; institution: string; dates: string; points: string[] }[]
  skills: { group: string; items: string[] }[]
  projects: ProjectRecord[]
  awards?: { title: string; detail: string; date: string }[]
  /** Sourced, editable availability for internship emails. Used only while `confirmed` is true. Nothing here is ever copied between profiles. */
  availability?: { studyYear?: string; programme?: string; duration?: string; start?: string; end?: string; detail?: string; confirmed: boolean; source?: string }
  /** One sentence fragment such as "have received the Dean's List Award twice". Optional. */
  academicHighlight?: string
  /** Email copy preferences. `leadership: false` keeps college positions out of generated email bodies (they stay in the profile and CV evidence). Absent means included. */
  emailOptions?: { leadership?: boolean }
  /** Hand-written master content (private). Used only for the master resume. */
  master?: { headline: string; summary: string }
  otherRepos: { name: string; note: string; url: string }[]
  experience: { title: string; organisation: string; date: string; points: string[] }[]
  /** `year`, `themes` and `source` are optional so older entries stay valid. `themes` are role words only, for CV tailoring. */
  leadership: { id?: string; title: string; organisation: string; date: string; points: string[]; year?: number; scope?: string; themes?: string[]; source?: string }[]
  languages: string[]; interests: string[]; internshipWindow: string; availabilityPhrase: string
  reviewNotes: string[]; documents: DocEntry[]; seeded: boolean
  /** Generated CV drafts and approved versions. Never overwrite the documents above. */
  cvs?: CvRecord[]; masterDocId?: string | null
}
interface Doc { version: 1; profiles: Profile[] }

const EMPTY = (id: ProfileId): Profile => ({
  id, displayName: id === 'adam' ? 'Adam' : 'Akif', fullName: '', specialisation: id === 'adam' ? 'Data Science' : 'Information Systems', university: 'Universiti Malaya', degree: '',
  contact: { email: '', phone: '', location: '' }, links: [], headline: '', summary: '', education: [], skills: [], projects: [], otherRepos: [], experience: [], leadership: [],
  languages: [], interests: [], internshipWindow: '', availabilityPhrase: '', reviewNotes: [], documents: [], seeded: false,
})

export class StoreError extends Error { constructor(m: string, public code = 'VIEWER') { super(m) } }
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const rid = (p: string) => `${p}_${crypto.randomBytes(5).toString('hex')}`

export function sniffDoc(buf: Buffer, name: string): 'pdf' | 'docx' {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.pdf' && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (ext === '.docx' && buf[0] === 0x50 && buf[1] === 0x4b) return 'docx'
  throw new StoreError('Choose a PDF or Word (.docx) file. The file contents must match its extension.', 'BAD_FILE')
}

export class ViewerStore {
  readonly dir: string
  private file: string
  private doc: Doc
  /** Set when an unreadable profiles.json was moved aside on start-up. */
  recovered: string | null = null
  constructor(userData: string, private seedPaths: string[] = []) {
    this.dir = path.join(userData, 'viewer')
    this.file = path.join(this.dir, 'profiles.json')
    fs.mkdirSync(this.dir, { recursive: true })
    this.doc = this.load()
    this.ensure()
  }

  private load(): Doc {
    if (!fs.existsSync(this.file)) return { version: 1, profiles: [] }
    try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Doc; if (d?.version === 1 && Array.isArray(d.profiles)) return d } catch { /* fall through */ }
    // Unreadable file: never overwrite it. Keep it aside so nothing is lost, then start from the seed.
    const aside = `${this.file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    fs.renameSync(this.file, aside); this.recovered = aside
    return { version: 1, profiles: [] }
  }
  private save() {
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.doc, null, 1), { mode: 0o600 }); fs.renameSync(tmp, this.file)
  }
  private seedData(): Profile[] | null {
    for (const p of this.seedPaths) {
      try { const d = JSON.parse(fs.readFileSync(p, 'utf8')); if (d?.version === 1 && Array.isArray(d.profiles)) return d.profiles.map((x: any) => ({ ...x, __dir: path.dirname(p) })) } catch { /* try next */ }
    }
    return null
  }

  /** Make sure both profiles exist. A stub is upgraded from the seed only while the profile has never been seeded. */
  private ensure() {
    const seed = this.seedData()
    let dirty = false
    for (const id of PROFILE_IDS) {
      let cur = this.doc.profiles.find((p) => p.id === id)
      if (!cur) { cur = EMPTY(id); this.doc.profiles.push(cur); dirty = true }
      const s = seed?.find((x: any) => x.id === id)
      if (s && !cur.seeded) {
        const { documents: seedDocs, ...rest } = s as any
        delete (rest as any).__dir
        Object.assign(cur, { ...EMPTY(id), ...rest, documents: cur.documents, seeded: true })
        for (const d of seedDocs ?? []) {
          try { this.addFile(id, { src: d.path, label: d.label, kind: d.kind, quiet: true }) } catch { cur.reviewNotes.push(`Could not link "${d.label}": the source file was not found.`) }
        }
        dirty = true
      }
    }
    if (dirty) this.save()
  }

  list(): Profile[] { return this.doc.profiles.map((p) => structuredClone(p)) }
  get(id: string): Profile {
    const p = this.doc.profiles.find((x) => x.id === id)
    if (!p) throw new StoreError('Unknown profile.', 'NOT_FOUND')
    return p
  }
  summary() { return this.doc.profiles.map((p) => ({ id: p.id, displayName: p.displayName, specialisation: p.specialisation, university: p.university, initials: p.displayName.slice(0, 2) })) }

  /** Optional edits only. Unknown keys are ignored. */
  patch(id: string, patch: Partial<Pick<Profile, 'headline' | 'summary' | 'internshipWindow' | 'availabilityPhrase' | 'interests' | 'languages' | 'academicHighlight'>> & { contact?: Partial<Profile['contact']>; availability?: Partial<NonNullable<Profile['availability']>> }) {
    const p = this.get(id)
    for (const k of ['headline', 'summary', 'internshipWindow', 'availabilityPhrase'] as const) if (typeof patch[k] === 'string') p[k] = patch[k]!.slice(0, 2000)
    for (const k of ['interests', 'languages'] as const) if (Array.isArray(patch[k])) p[k] = patch[k]!.map((s) => String(s).slice(0, 120)).slice(0, 40)
    if (typeof patch.academicHighlight === 'string') p.academicHighlight = patch.academicHighlight.slice(0, 200)
    if (patch.availability) { const a = (p.availability ??= { confirmed: false }); for (const k of ['studyYear', 'programme', 'duration', 'start', 'end', 'detail', 'source'] as const) if (typeof patch.availability[k] === 'string') a[k] = patch.availability[k]!.slice(0, 200); if (typeof patch.availability.confirmed === 'boolean') a.confirmed = patch.availability.confirmed }
    if (patch.contact) for (const k of ['email', 'phone', 'location'] as const) if (typeof patch.contact[k] === 'string') p.contact[k] = patch.contact[k]!.slice(0, 200)
    this.save(); return structuredClone(p)
  }

  // ---------------------------------------------------------------- documents
  fileState(v: DocVersion): 'OK' | 'MISSING' | 'CHANGED' {
    const f = path.join(this.dir, v.file)
    if (!fs.existsSync(f)) return 'MISSING'
    return sha(fs.readFileSync(f)) === v.sha256 ? 'OK' : 'CHANGED'
  }
  documents(id: string) {
    return this.get(id).documents.filter((d) => !d.archived).map((d) => ({ ...d, versions: [...d.versions].reverse().map((v) => ({ ...v, state: this.fileState(v) })) }))
  }

  addFile(id: string, i: { src: string; label?: string; kind?: 'CV' | 'RESUME'; docId?: string; note?: string; quiet?: boolean }) {
    const p = this.get(id)
    if (!fs.existsSync(i.src)) throw new StoreError('That file could not be found.', 'FILE_MISSING')
    const st = fs.statSync(i.src)
    if (!st.isFile()) throw new StoreError('Choose a file, not a folder.', 'BAD_FILE')
    if (st.size === 0) throw new StoreError('That file is empty.', 'BAD_FILE')
    if (st.size > MAX_DOC_BYTES) throw new StoreError('That file is larger than 10 MB.', 'TOO_BIG')
    const buf = fs.readFileSync(i.src)
    const ext = sniffDoc(buf, i.src)
    const digest = sha(buf)
    let d = i.docId ? p.documents.find((x) => x.id === i.docId) : undefined
    if (i.docId && !d) throw new StoreError('Unknown document.', 'NOT_FOUND')
    if (d) { const dup = d.versions.find((v) => v.sha256 === digest); if (dup) throw new StoreError(`This exact file is already saved as version ${dup.version}.`, 'DUPLICATE') }
    else {
      const same = p.documents.find((x) => x.versions.some((v) => v.sha256 === digest))
      if (same && i.quiet) return { docId: same.id, version: same.versions.length }
      if (same) throw new StoreError(`This exact file is already saved in “${same.label}” as version ${same.versions.find((v) => v.sha256 === digest)!.version}.`, 'DUPLICATE')
      d = { id: rid('doc'), label: (i.label ?? '').trim().slice(0, 80) || path.basename(i.src, path.extname(i.src)), kind: i.kind ?? 'RESUME', archived: false, versions: [] }
      p.documents.push(d)
    }
    const n = d.versions.length + 1
    const rel = path.join('documents', id, `${d.id}-v${String(n).padStart(2, '0')}.${ext}`)
    const dest = path.join(this.dir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, buf, { flag: 'wx', mode: 0o600 })     // versions are immutable: never overwrite
    d.versions.push({ id: rid('v'), version: n, originalName: path.basename(i.src), file: rel, sha256: digest, size: buf.length, addedAt: new Date().toISOString(), note: i.note?.trim() || null })
    this.save()
    return { docId: d.id, version: n }
  }
  rename(id: string, docId: string, label: string) {
    const d = this.get(id).documents.find((x) => x.id === docId); if (!d) throw new StoreError('Unknown document.', 'NOT_FOUND')
    const l = label.trim(); if (!l) throw new StoreError('Give the document a name.', 'BAD_INPUT'); d.label = l.slice(0, 80); this.save(); return true
  }
  setKind(id: string, docId: string, kind: 'CV' | 'RESUME') {
    const d = this.get(id).documents.find((x) => x.id === docId); if (!d) throw new StoreError('Unknown document.', 'NOT_FOUND')
    d.kind = kind; this.save(); return true
  }
  archive(id: string, docId: string, archived: boolean) {
    const d = this.get(id).documents.find((x) => x.id === docId); if (!d) throw new StoreError('Unknown document.', 'NOT_FOUND')
    d.archived = archived; this.save(); return true
  }
  // ---------------------------------------------------------------- CV drafts and approved versions
  cvList(id: string): CvRecord[] { return structuredClone(this.get(id).cvs ?? []) }
  cvGet(id: string, recId: string): CvRecord {
    const r = (this.get(id).cvs ?? []).find((x) => x.id === recId); if (!r) throw new StoreError('Unknown CV.', 'NOT_FOUND'); return r
  }
  /** Adds a record or a new version. Existing versions are never changed, except that approving one stamps it. */
  cvAddVersion(id: string, rec: { recId?: string; mode: CvRecord['mode']; label: string; companyId?: string; companyName?: string; role?: string | null; vacancy: 'NONE' | 'GIVEN' }, v: { ast: any; note: string; source: CvVersion['source'] }): { rec: CvRecord; version: CvVersion } {
    const p = this.get(id); p.cvs ??= []
    let r = rec.recId ? p.cvs.find((x) => x.id === rec.recId) : undefined
    if (rec.recId && !r) throw new StoreError('Unknown CV.', 'NOT_FOUND')
    if (!r) { r = { id: rid('cv'), mode: rec.mode, label: rec.label.slice(0, 120), companyId: rec.companyId, companyName: rec.companyName, role: rec.role ?? null, vacancy: rec.vacancy, versions: [] }; p.cvs.push(r) }
    const version: CvVersion = { id: rid('cvv'), n: r.versions.length + 1, createdAt: new Date().toISOString(), ast: structuredClone(v.ast), note: v.note.slice(0, 300), source: v.source, status: 'DRAFT' }
    r.versions.push(version); this.save(); return { rec: structuredClone(r), version: structuredClone(version) }
  }
  /** Writes the approved PDF as a new immutable file under cv/<profile>/ and stamps the version. */
  cvApprove(id: string, recId: string, versionId: string, pdf: Buffer, fileName: string, pages: number): CvVersion {
    const r = this.cvGet(id, recId); const v = r.versions.find((x) => x.id === versionId); if (!v) throw new StoreError('Unknown version.', 'NOT_FOUND')
    if (v.status === 'APPROVED') return structuredClone(v)
    const base = fileName.replace(/[^\w.\-]+/g, '_'); const ext = path.extname(base) || '.pdf'; const stem = path.basename(base, ext)
    const dir = path.join(this.dir, 'cv', id); fs.mkdirSync(dir, { recursive: true })
    let rel = path.join('cv', id, base), k = 2
    while (fs.existsSync(path.join(this.dir, rel))) rel = path.join('cv', id, `${stem}-v${k++}${ext}`)
    fs.writeFileSync(path.join(this.dir, rel), pdf, { flag: 'wx', mode: 0o600 })
    v.status = 'APPROVED'; v.approvedAt = new Date().toISOString(); v.file = rel; v.sha256 = sha(pdf); v.pages = pages
    this.save(); return structuredClone(v)
  }
  cvFilePath(id: string, recId: string, versionId: string): string {
    const v = this.cvGet(id, recId).versions.find((x) => x.id === versionId); if (!v?.file) throw new StoreError('That version is not approved yet.', 'NOT_APPROVED')
    const f = path.resolve(this.dir, v.file); if (!f.startsWith(path.resolve(this.dir) + path.sep)) throw new StoreError('Refusing to read outside the Career Hub folder.', 'FORBIDDEN'); return f
  }
  setMasterDoc(id: string, docId: string) { this.get(id).masterDocId = docId; this.save() }

  /** Replaces a profile's project inventory, awards, master text and skills. Documents, leadership and everything else stay as they are. */
  setPortfolio(id: string, d: { projects: ProjectRecord[]; awards?: Profile['awards']; master?: Profile['master']; skills?: Profile['skills'] }) {
    const p = this.get(id)
    if (!Array.isArray(d.projects) || !d.projects.every((x) => x && typeof x.title === 'string' && Array.isArray(x.stack))) throw new StoreError('The project inventory is not valid.', 'BAD_INPUT')
    p.projects = structuredClone(d.projects); if (d.awards) p.awards = structuredClone(d.awards); if (d.master) p.master = structuredClone(d.master); if (d.skills) p.skills = structuredClone(d.skills)
    this.save(); return structuredClone(p)
  }

  /** Absolute path of one version, confined to the viewer directory. */
  versionPath(id: string, versionId: string): { path: string; v: DocVersion } {
    for (const d of this.get(id).documents) {
      const v = d.versions.find((x) => x.id === versionId)
      if (v) {
        const f = path.resolve(this.dir, v.file)
        if (!f.startsWith(path.resolve(this.dir) + path.sep)) throw new StoreError('Refusing to read outside the Career Hub folder.', 'FORBIDDEN')
        return { path: f, v }
      }
    }
    throw new StoreError('Unknown document version.', 'NOT_FOUND')
  }
}
