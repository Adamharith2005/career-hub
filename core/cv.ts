import fs from 'node:fs'
import path from 'node:path'
import { DB, all, get, run, id, nowIso } from './db.ts'
import { findTech } from './domain.ts'
import { sha256 } from './storage.ts'
import { addFact, listFacts, type FactInput, type Identity } from './profiles.ts'

// ------------------------------------------------------------------ text extraction
export interface Extracted { text: string; pages: number; links: string[]; scannedLikely: boolean; pageTexts?: string[] }

export async function extractPdf(data: Uint8Array): Promise<Extracted> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, isEvalSupported: false, verbosity: 0 })
  const doc = await task.promise
  const lines: string[] = []
  const links: string[] = []
  const pageTexts: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const startIdx = lines.length
    const content = await page.getTextContent()
    let cur: string[] = [], lastY: number | null = null
    for (const it of content.items as any[]) {
      if (typeof it.str !== 'string') continue
      const y = Math.round(it.transform[5])
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(cur.join('').replace(/\s+/g, ' ').trim()); cur = [] }
      cur.push(it.str); lastY = y
      if (it.hasEOL) { lines.push(cur.join('').replace(/\s+/g, ' ').trim()); cur = []; lastY = null }
    }
    if (cur.length) lines.push(cur.join('').replace(/\s+/g, ' ').trim())
    pageTexts.push(lines.slice(startIdx).join('\n'))
    lines.push('')
    for (const a of (await page.getAnnotations()) as any[]) if (a.url) links.push(a.url)
  }
  const pages = doc.numPages
  await task.destroy()
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, pages, links: [...new Set(links)], scannedLikely: text.replace(/\s/g, '').length < 80, pageTexts }
}

export async function extractDocx(file: string): Promise<Extracted> {
  const mammoth: any = await import('mammoth')
  const m = mammoth.default ?? mammoth
  const r = await m.extractRawText({ path: file })
  const text = String(r.value).replace(/\n{3,}/g, '\n\n').trim()
  return { text, pages: 0, links: [], scannedLikely: text.length < 80 }
}

export async function extractFile(file: string): Promise<Extracted> {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.pdf') return extractPdf(fs.readFileSync(file))
  if (ext === '.docx') return extractDocx(file)
  throw new Error('Please choose a PDF or DOCX file.')
}

// ------------------------------------------------------------------ parsing
type Sec = 'HEAD' | 'SUMMARY' | 'EDUCATION' | 'SKILL' | 'PROJECT' | 'EXPERIENCE' | 'LEADERSHIP' | 'CERTIFICATION' | 'AWARD' | 'LANGUAGE'
const HEADINGS: [RegExp, Sec][] = [
  [/^(education|academic background|academic qualifications?|qualifications?|pendidikan)$/i, 'EDUCATION'],
  [/^(technical skills?|skills?|skills? (&|and) tools|technical proficiency|core competenc(y|ies)|technologies|tech stack|kemahiran)$/i, 'SKILL'],
  [/^(projects?|personal projects?|academic projects?|selected projects?|key projects?|final year projects?|technical projects?|projek)$/i, 'PROJECT'],
  [/^((work|professional|relevant|industrial)? ?experience|employment( history)?|internships?|work history|pengalaman)$/i, 'EXPERIENCE'],
  [/^(leadership|activities|extracurricular(s| activities)?|volunteer(ing)?( experience)?|co-?curricular( activities)?|involvement|leadership (&|and) activities)$/i, 'LEADERSHIP'],
  [/^(certifications?|licenses?( (&|and) certifications?)?|courses|training|professional development)$/i, 'CERTIFICATION'],
  [/^(awards?( (&|and) (honou?rs|achievements?))?|honou?rs|achievements?|scholarships?)$/i, 'AWARD'],
  [/^(languages?|bahasa)$/i, 'LANGUAGE'],
  [/^(summary|profile|objective|about me|professional summary|career objective)$/i, 'SUMMARY'],
]
const BULLET = /^\s*[•\-–—·*▪●◦■►]\s*/
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DATE = `(?:${MONTH}\\.?\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to)\\s*(${DATE}|present|current|now|ongoing)`, 'i')
const SINGLE = new RegExp(`\\b(${DATE})\\b`, 'i')
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
const PHONE = /(\+?60|0)\s?-?\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4}/
const METRIC = /\b\d+(?:\.\d+)?\s?(?:%|x\b|ms\b|seconds?\b|users?\b|requests?\b|records?\b|hours?\b|students?\b|participants?\b|teams?\b)|\bRM\s?\d[\d,]*/gi

function headingOf(line: string): Sec | null {
  const t = line.replace(/[:：_*#=\-–—|]+$/g, '').replace(/^[#=\-–—|*_\s]+/, '').trim()
  if (!t || t.length > 42) return null
  for (const [re, s] of HEADINGS) if (re.test(t)) return s
  return null
}

export interface ParsedCv { identity: Identity; summary: string; facts: FactInput[]; warnings: string[] }

export function parseCvText(text: string, docId: string, links: string[] = []): ParsedCv {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
  const warnings: string[] = []
  const identity: Identity = {}
  const head = lines.slice(0, 12).filter(Boolean)
  const em = text.match(EMAIL); if (em) identity.email = em[0]
  const ph = text.match(PHONE); if (ph) identity.phone = ph[0].trim()
  const allLinks = [...links, ...(text.match(/(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in|github\.com)\/[A-Za-z0-9._\-/]+/gi) ?? [])]
  for (const l of allLinks) {
    const u = /^https?:/i.test(l) ? l : `https://${l}`
    if (/linkedin\.com/i.test(u) && !identity.linkedin) identity.linkedin = u
    else if (/github\.com/i.test(u) && !identity.github) identity.github = u
    else if (!/mailto:|linkedin|github/i.test(u) && !identity.portfolio) identity.portfolio = u
  }
  const nameLine = head.find((l) => !/[@\d]/.test(l) && headingOf(l) == null && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 6 && !/resume|curriculum|cv$/i.test(l))
  if (nameLine) identity.fullName = nameLine.replace(/\s{2,}.*/, '').trim()
  const loc = head.find((l) => /malaysia|selangor|kuala lumpur|cyberjaya|putrajaya|johor|penang|perak/i.test(l))
  if (loc) identity.location = loc.replace(EMAIL, '').replace(PHONE, '').replace(/(?:\s*[|•·]\s*){2,}/g, ' | ').replace(/^[\s|•·,]+|[\s|•·,]+$/g, '').trim().slice(0, 80)

  // split into sections
  const secs: { sec: Sec; start: number; lines: { n: number; t: string }[] }[] = [{ sec: 'HEAD', start: 0, lines: [] }]
  lines.forEach((t, n) => {
    const h = headingOf(t)
    if (h) secs.push({ sec: h, start: n, lines: [] })
    else secs[secs.length - 1].lines.push({ n: n + 1, t })
  })
  if (secs.length === 1) warnings.push('No section headings (Education, Skills, Projects…) were recognised. Please add your details manually.')

  const facts: FactInput[] = []
  let summary = ''
  const cite = (a: number, b: number) => `cv:${docId}#L${a}-${b}`

  for (const s of secs) {
    const body = s.lines.filter((l) => l.t.trim())
    if (!body.length) continue
    const first = body[0].n, last = body[body.length - 1].n
    switch (s.sec) {
      case 'SUMMARY': summary = body.map((l) => l.t.trim()).join(' ').slice(0, 600); break
      case 'EDUCATION': {
        const entries: { n: number; t: string }[][] = []
        for (const l of body) {
          const startsNew = /(universiti|university|college|institute|politeknik|kolej|school|academy)/i.test(l.t) && !BULLET.test(l.t)
          if (startsNew || !entries.length) entries.push([l]); else entries[entries.length - 1].push(l)
        }
        for (const e of entries) {
          const txt = e.map((l) => l.t.trim())
          const uni = txt.find((t) => /(universiti|university|college|institute|politeknik|kolej|school)/i.test(t)) ?? txt[0]
          const deg = txt.find((t) => /(bachelor|b\.?\s?sc|b\.?\s?eng|b\.?\s?cs|diploma|master|foundation|degree|sarjana|ijazah|computer science|information technology)/i.test(t) && t !== uni) ?? ''
          const range = txt.join(' ').match(RANGE) ?? null
          const single = range ? null : txt.join(' ').match(SINGLE)
          facts.push({
            category: 'EDUCATION', title: (deg || uni).replace(RANGE, '').replace(/[|,–—-]\s*$/, '').trim(), organization: uni.replace(RANGE, '').replace(/[|,–—-]\s*$/, '').trim(),
            date_start: range?.[1] ?? null, date_end: range?.[2] ?? single?.[1] ?? null, claim_text: txt.join('\n'), tools: [],
            metrics: (txt.join(' ').match(/cgpa[:\s]*\d(?:\.\d+)?(?:\s*\/\s*\d(?:\.\d+)?)?/gi) ?? []),
            source_citation: cite(e[0].n, e[e.length - 1].n), confidence: 'medium',
          })
        }
        break
      }
      case 'SKILL': {
        for (const l of body) {
          const t = l.t.replace(BULLET, '').trim()
          if (!t) continue
          const m = t.match(/^([^:]{2,40}):\s*(.+)$/)
          const items = (m ? m[2] : t).split(/[,;•|·]/).map((x) => x.trim()).filter((x) => x && x.length < 40)
          if (!items.length) continue
          facts.push({ category: 'SKILL', title: m ? m[1].trim() : 'Skills', claim_text: items.join(', '), tools: items, source_citation: cite(l.n, l.n), confidence: 'medium' })
        }
        break
      }
      case 'PROJECT': case 'EXPERIENCE': case 'LEADERSHIP': {
        type E = { head: { n: number; t: string }[]; bullets: { n: number; t: string }[] }
        const entries: E[] = []
        let cur: E | null = null
        let prevWasBullet = false
        for (const l of body) {
          const isBullet = BULLET.test(l.t)
          if (isBullet) {
            if (!cur) { cur = { head: [], bullets: [] }; entries.push(cur) }
            cur.bullets.push({ n: l.n, t: l.t.replace(BULLET, '').trim() }); prevWasBullet = true
          } else if (cur && prevWasBullet && (/^[a-z(]/.test(l.t.trim()) || (cur.bullets.at(-1)!.t.length > 70 && !RANGE.test(l.t) && !/\|/.test(l.t)))) {
            cur.bullets[cur.bullets.length - 1].t += ' ' + l.t.trim() // wrapped bullet
          } else if (cur && !cur.bullets.length && cur.head.length < 2) {
            cur.head.push({ n: l.n, t: l.t.trim() })
          } else {
            cur = { head: [{ n: l.n, t: l.t.trim() }], bullets: [] }; entries.push(cur); prevWasBullet = false
          }
        }
        for (const e of entries) {
          const headText = e.head.map((h) => h.t).join(' | ')
          if (!headText && !e.bullets.length) continue
          const range = headText.match(RANGE)
          const clean = headText.replace(RANGE, '').replace(/\(\s*\)/g, '')
          const parts = clean.split(/\s*[|–—]\s*|\s{3,}|\s-\s/).map((x) => x.trim().replace(/[,|]\s*$/, '')).filter(Boolean)
          const title = parts[0] ?? e.bullets[0]?.t.slice(0, 60) ?? 'Untitled'
          const rest = parts.slice(1).join(', ')
          const full = [headText, ...e.bullets.map((b) => b.t)].join('\n')
          const a = e.head[0]?.n ?? e.bullets[0].n, b = e.bullets.at(-1)?.n ?? e.head.at(-1)!.n
          facts.push({
            category: s.sec as FactInput['category'], title, organization: s.sec === 'PROJECT' ? null : rest || null,
            date_start: range?.[1] ?? null, date_end: range?.[2] ?? null,
            claim_text: [s.sec === 'PROJECT' && rest ? `(${rest})` : '', ...e.bullets.map((x) => x.t)].filter(Boolean).join('\n'),
            tools: findTech(full), metrics: [...new Set(full.match(METRIC) ?? [])], source_citation: cite(a, b), confidence: e.bullets.length ? 'medium' : 'low',
          })
        }
        break
      }
      case 'CERTIFICATION': case 'AWARD': {
        for (const l of body) {
          const t = l.t.replace(BULLET, '').trim()
          if (t.length < 3) continue
          const r = t.match(RANGE) ?? t.match(SINGLE)
          facts.push({ category: s.sec as FactInput['category'], title: t.replace(RANGE, '').replace(SINGLE, '').replace(/[|,–—-]\s*$/, '').trim(), claim_text: t, date_end: r ? (r[2] ?? r[1]) : null, source_citation: cite(l.n, l.n), confidence: 'medium' })
        }
        break
      }
      case 'LANGUAGE': {
        const items = body.map((l) => l.t.replace(BULLET, '')).join(', ').split(/[,;|]/).map((x) => x.trim()).filter(Boolean)
        if (items.length) facts.push({ category: 'LANGUAGE', title: 'Languages', claim_text: items.join(', '), tools: items, source_citation: cite(first, last), confidence: 'medium' })
        break
      }
      default: break
    }
  }
  if (identity.github) facts.push({ category: 'LINK', title: 'GitHub', claim_text: identity.github, source_citation: 'cv:links', confidence: 'high' })
  if (!facts.some((f) => f.category === 'EDUCATION')) warnings.push('No education details were found — please add your degree and university.')
  if (!facts.some((f) => f.category === 'PROJECT')) warnings.push('No projects were found — add at least one project so tailored documents have evidence to use.')
  return { identity, summary, facts, warnings }
}

// ------------------------------------------------------------------ persistence
const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 2))
export function similarity(a: string, b: string) {
  const A = tokens(a), B = tokens(b)
  if (!A.size || !B.size) return 0
  let i = 0; A.forEach((x) => B.has(x) && i++)
  return i / (A.size + B.size - i)
}

export interface ImportCvResult {
  doc_id: string; duplicate: 'exact' | 'near' | null; duplicate_of?: string; scanned_likely: boolean; pages: number
  identity: Identity; warnings: string[]; added: number; unchanged: number; changed: number
}

export async function importCv(db: DB, profileId: string, srcFile: string, storeDir: string, kind: 'MASTER_CV' | 'RESUME' | 'SUPPORT' = 'MASTER_CV'): Promise<ImportCvResult> {
  const buf = fs.readFileSync(srcFile)
  const hash = sha256(buf)
  const ex = await extractFile(srcFile)
  const existing = all<any>(db, 'SELECT * FROM source_documents WHERE profile_id=? AND kind != ?', profileId, 'SUPPORT')
  const exact = existing.find((d) => d.sha256 === hash)
  const near = !exact ? existing.find((d) => similarity(d.text_content, ex.text) > 0.9) : undefined
  const doc_id = exact?.doc_id ?? id('sd')
  if (!exact) {
    fs.mkdirSync(storeDir, { recursive: true })
    let dest = path.join(storeDir, path.basename(srcFile))
    if (fs.existsSync(dest)) dest = path.join(storeDir, `${path.parse(srcFile).name}-${hash.slice(0, 8)}${path.extname(srcFile)}`)
    fs.copyFileSync(srcFile, dest) // original preserved byte-for-byte, never modified
    run(db, `INSERT INTO source_documents (doc_id, profile_id, kind, original_name, stored_path, sha256, text_content, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      doc_id, profileId, kind, path.basename(srcFile), dest, hash, ex.text, nowIso())
  }
  const result: ImportCvResult = { doc_id, duplicate: exact ? 'exact' : near ? 'near' : null, duplicate_of: (exact ?? near)?.original_name, scanned_likely: ex.scannedLikely, pages: ex.pages,
    identity: {}, warnings: [], added: 0, unchanged: 0, changed: 0 }
  if (kind === 'SUPPORT') return result
  if (ex.scannedLikely) { result.warnings.push('This PDF looks scanned (almost no selectable text). OCR is not enabled — please add your details manually or upload a text-based PDF/DOCX.'); return result }
  const parsed = parseCvText(ex.text, doc_id, ex.links)
  result.identity = parsed.identity; result.warnings = parsed.warnings
  const have = listFacts(db, profileId)
  const key = (f: { category: string; title: string }) => `${f.category}::${f.title.toLowerCase().replace(/\s+/g, ' ')}`
  const byKey = new Map(have.map((f) => [key(f), f]))
  for (const f of parsed.facts) {
    const cur = byKey.get(key(f))
    if (!cur) { addFact(db, profileId, { ...f, confirmed: false }); result.added++ }
    else if (cur.claim_text.trim() === (f.claim_text ?? '').trim()) result.unchanged++
    else { // never overwrite a (possibly confirmed) fact: add the new wording as an unconfirmed candidate for review
      addFact(db, profileId, { ...f, title: f.title, confirmed: false, source_citation: `${f.source_citation} (differs from existing ${cur.fact_id})` }); result.changed++
    }
  }
  return result
}

export const listSourceDocs = (db: DB, profileId: string) =>
  all(db, 'SELECT doc_id, kind, original_name, stored_path, sha256, created_at FROM source_documents WHERE profile_id=? ORDER BY created_at DESC', profileId)
export const getSourceDoc = (db: DB, profileId: string, docId: string) => get(db, 'SELECT * FROM source_documents WHERE profile_id=? AND doc_id=?', profileId, docId)
