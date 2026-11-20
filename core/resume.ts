import { findTech, TECH_NAMES, slugify } from './domain.ts'
import type { JobSpec } from './job.ts'
import type { Fact, Profile } from './profiles.ts'

// ------------------------------------------------------------------ AST
export interface Bullet { id: string; text: string; original: string; sourceFactIds: string[] }
export interface ResumeItem { id: string; heading: string; subheading?: string; dates?: string; bullets: Bullet[]; factIds: string[] }
export interface SkillGroup { label: string; values: string[]; factIds: string[] }
export interface ResumeSection {
  id: string; title: string
  kind: 'education' | 'skills' | 'projects' | 'experience' | 'leadership' | 'certifications' | 'awards'
  items?: ResumeItem[]; skillGroups?: SkillGroup[]
}
export interface ChangeLogEntry { kind: 'included' | 'omitted' | 'ordered' | 'edited'; factId?: string; section: string; reason: string }
export interface ResumeAST {
  schema: 1; language: 'en' | 'ms'; target: { company: string; role: string }
  header: { name: string; contacts: { label: string; text: string; url?: string }[] }
  summary?: { text: string; factIds: string[] }
  sections: ResumeSection[]
  changelog: ChangeLogEntry[]
}
export interface LetterAST {
  schema: 1; language: 'en' | 'ms'; target: { company: string; role: string }
  sender: { name: string; lines: string[] }; date: string; recipient: string[]; subject: string; salutation: string
  paragraphs: { id: string; text: string; factIds: string[] }[]; closing: string; signature: string
}

const D = (s?: string | null) => (s ?? '').trim()
export const dateRange = (a?: string | null, b?: string | null) => (a && b ? `${a} – ${b}` : a ? `${a} – Present` : b ?? '')
const splitLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const bulletsOf = (f: Fact) => splitLines(f.claim_text).filter((l) => !/^\(.*\)$/.test(l))
const nid = (() => { let n = 0; return (p: string) => `${p}${++n}` })()
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
export const tidyText = (s: string) => s.replace(/(?:\s*[|•·]\s*){2,}/g, ' | ').replace(/^[\s|•·,]+|[\s|•·,]+$/g, '').trim()

/** "pursuing a Bachelor of … at Uni" / "completed a … at Uni" — grammatical, and only as certain as the facts (end year decides tense). */
export function eduClause(e: Fact, lang: 'en' | 'ms', now = new Date()): string {
  const uni = D(e.organization), title = e.title
  const endYear = Number((e.date_end ?? '').match(/\d{4}/)?.[0] ?? 0)
  const done = endYear > 0 && endYear < now.getFullYear()
  const isDegree = /^(bachelor|diploma|master|foundation|degree|sarjana|ijazah|ph\.?d)/i.test(title)
  const at = uni && uni.toLowerCase() !== title.toLowerCase() ? (lang === 'ms' ? ` di ${uni}` : ` at ${uni}`) : ''
  if (lang === 'ms') return `${done ? 'telah menamatkan' : 'sedang mengikuti'} ${title}${at}`
  return isDegree ? `${done ? 'completed' : 'pursuing'} a ${title}${at}` : `${done ? 'completed studies in' : 'studying'} ${title}${at}`
}
const INTERNISH = /intern|trainee|graduate|junior|entry|latihan/i
/** The noun phrase that follows "the": avoids "Intern internship". */
export function rolePhrase(role: string, careerType: 'INTERNSHIP' | 'GRADUATE', lang: 'en' | 'ms'): string {
  if (lang === 'ms') return INTERNISH.test(role) ? `jawatan ${role}` : careerType === 'INTERNSHIP' ? `latihan industri ${role}` : `jawatan ${role}`
  return INTERNISH.test(role) ? `${role} role` : careerType === 'INTERNSHIP' ? `${role} internship` : `${role} position`
}
export const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

const factTechSet = (f: Fact) => new Set(findTech([f.title, f.claim_text, f.tools.join(' ')].join('\n')))
function relevance(f: Fact, wanted: Set<string>) {
  const t = factTechSet(f)
  return { overlap: [...t].filter((x) => wanted.has(x)), count: [...t].filter((x) => wanted.has(x)).length }
}
const endKey = (f: Fact) => (/present|current|ongoing|now/i.test(f.date_end ?? '') ? 9999 : Number((f.date_end ?? f.date_start ?? '').match(/\d{4}/)?.[0] ?? 0))

export interface BuildOpts { language?: 'en' | 'ms'; careerType?: 'INTERNSHIP' | 'GRADUATE'; maxProjects?: number }

export function buildResume(profile: Profile, allFacts: Fact[], spec: Pick<JobSpec, 'required' | 'preferred' | 'roleFamily'> & { title?: string | null; company?: string | null }, opts: BuildOpts = {}): ResumeAST {
  const facts = allFacts.filter((f) => f.confirmed)
  const log: ChangeLogEntry[] = []
  const wanted = new Set([...spec.required, ...spec.preferred])
  const career = opts.careerType ?? 'INTERNSHIP'
  const id = profile.identity
  const contacts: ResumeAST['header']['contacts'] = []
  if (id.email) contacts.push({ label: 'Email', text: id.email, url: `mailto:${id.email}` })
  if (id.phone) contacts.push({ label: 'Phone', text: id.phone })
  if (id.location && tidyText(id.location)) contacts.push({ label: 'Location', text: tidyText(id.location) })
  if (id.linkedin) contacts.push({ label: 'LinkedIn', text: shortUrl(id.linkedin), url: id.linkedin })
  if (id.github) contacts.push({ label: 'GitHub', text: shortUrl(id.github), url: id.github })
  if (id.portfolio) contacts.push({ label: 'Portfolio', text: shortUrl(id.portfolio), url: id.portfolio })

  const sections: ResumeSection[] = []

  // Education
  const edu = facts.filter((f) => f.category === 'EDUCATION')
  if (edu.length) {
    sections.push({
      id: 'education', title: 'Education', kind: 'education',
      items: edu.map((f) => {
        // Drop claim lines that merely repeat the heading (optionally followed by a date range) — they are not achievements.
        const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+'
        const bare = (s: string) => s.replace(new RegExp(`\\b(?:${MON})?\\d{4}\\s*(?:[-–—]|to)\\s*(?:(?:${MON})?\\d{4}|present|current)`, 'gi'), '').replace(/[\s|,–—-]+$/g, '').trim().toLowerCase()
        const lines = splitLines(f.claim_text).filter((l) => bare(l) !== '' && bare(l) !== bare(f.title) && bare(l) !== bare(f.organization ?? '') && l.length < 160)
        const heading = D(f.organization) || f.title
        const sub = f.organization && f.title !== f.organization ? f.title : undefined
        return { id: nid('e'), heading, subheading: sub, dates: dateRange(f.date_start, f.date_end), factIds: [f.fact_id],
          bullets: lines.filter((l) => l !== sub && l !== heading).slice(0, 3).map((l) => ({ id: nid('b'), text: l, original: l, sourceFactIds: [f.fact_id] })) }
      }),
    })
    edu.forEach((f) => log.push({ kind: 'included', factId: f.fact_id, section: 'Education', reason: 'Education is always shown' }))
  }

  // Skills (JD-relevant values first, nothing added)
  const skillFacts = facts.filter((f) => f.category === 'SKILL' || f.category === 'LANGUAGE')
  if (skillFacts.length) {
    const groups: SkillGroup[] = skillFacts.map((f) => {
      const vals = [...f.tools]
      const rel = (v: string) => findTech(v).some((t) => wanted.has(t)) ? 0 : 1
      vals.sort((a, b) => rel(a) - rel(b))   // stable: relevant first, others keep order
      return { label: f.category === 'LANGUAGE' ? 'Spoken languages' : f.title, values: vals, factIds: [f.fact_id] }
    }).filter((g) => g.values.length)
    groups.sort((a, b) => Number(b.values.some((v) => findTech(v).some((t) => wanted.has(t)))) - Number(a.values.some((v) => findTech(v).some((t) => wanted.has(t)))))
    sections.push({ id: 'skills', title: 'Technical Skills', kind: 'skills', skillGroups: groups })
    log.push({ kind: 'ordered', section: 'Technical Skills', reason: 'Skills that appear in the job description are listed first. No skills were added.' })
  }

  // Projects (ranked by overlap with the job)
  const maxP = opts.maxProjects ?? (career === 'INTERNSHIP' ? 3 : 4)
  const projects = facts.filter((f) => f.category === 'PROJECT')
    .map((f) => ({ f, ...relevance(f, wanted) })).sort((a, b) => b.count - a.count || endKey(b.f) - endKey(a.f))
  const chosenP = projects.slice(0, maxP)
  const projSection: ResumeSection | null = chosenP.length ? {
    id: 'projects', title: 'Projects', kind: 'projects',
    items: chosenP.map(({ f, overlap }, i) => {
      const tools = f.tools.length ? `Technologies: ${f.tools.join(', ')}` : undefined
      return { id: nid('p'), heading: f.title, subheading: tools, dates: dateRange(f.date_start, f.date_end), factIds: [f.fact_id],
        bullets: bulletsOf(f).slice(0, i === 0 ? 4 : 3).map((l) => ({ id: nid('b'), text: l, original: l, sourceFactIds: [f.fact_id] })) }
    }),
  } : null
  chosenP.forEach(({ f, overlap }) => log.push({ kind: 'included', factId: f.fact_id, section: 'Projects', reason: overlap.length ? `Matches job keywords: ${overlap.join(', ')}` : 'No keyword overlap, included as general evidence' }))
  projects.slice(maxP).forEach(({ f }) => log.push({ kind: 'omitted', factId: f.fact_id, section: 'Projects', reason: 'Lower relevance to this job (space limit)' }))

  // Experience / leadership
  const mk = (cat: Fact['category'], id: string, title: string, kind: ResumeSection['kind'], cap: number, per: number): ResumeSection | null => {
    const fs = facts.filter((f) => f.category === cat).sort((a, b) => endKey(b) - endKey(a)).slice(0, cap)
    if (!fs.length) return null
    fs.forEach((f) => log.push({ kind: 'included', factId: f.fact_id, section: title, reason: 'Included from your confirmed facts' }))
    return { id, title, kind, items: fs.map((f) => ({ id: nid('x'), heading: f.title, subheading: f.organization ?? undefined, dates: dateRange(f.date_start, f.date_end), factIds: [f.fact_id],
      bullets: bulletsOf(f).slice(0, per).map((l) => ({ id: nid('b'), text: l, original: l, sourceFactIds: [f.fact_id] })) })) }
  }
  const exp = mk('EXPERIENCE', 'experience', 'Experience', 'experience', 3, 4)
  const lead = mk('LEADERSHIP', 'leadership', 'Leadership & Activities', 'leadership', 2, 2)
  if (career === 'GRADUATE') { if (exp) sections.push(exp); if (projSection) sections.push(projSection) }
  else { if (projSection) sections.push(projSection); if (exp) sections.push(exp) }
  if (lead) sections.push(lead)

  for (const [cat, id, title, kind] of [['CERTIFICATION', 'certs', 'Certifications', 'certifications'], ['AWARD', 'awards', 'Awards', 'awards']] as const) {
    const fs = facts.filter((f) => f.category === cat).slice(0, 4)
    if (fs.length) {
      sections.push({ id, title, kind, items: fs.map((f) => ({ id: nid('c'), heading: f.claim_text || f.title, dates: undefined, factIds: [f.fact_id], bullets: [] })) })
      fs.forEach((f) => log.push({ kind: 'included', factId: f.fact_id, section: title, reason: 'Included from your confirmed facts' }))
    }
  }

  // Short, claim-free profile line (only when education + role are known)
  let summary: ResumeAST['summary']
  const e0 = edu[0]
  if (e0 && spec.title) {
    const p = profile.prefs
    const when = p.internshipStart && career === 'INTERNSHIP' ? ` Available from ${p.internshipStart}${p.internshipEnd ? ` to ${p.internshipEnd}` : ''}.` : ''
    const lang = opts.language === 'ms' ? 'ms' : 'en'
    const clause = eduClause(e0, lang)
    const cap = clause[0].toUpperCase() + clause.slice(1)
    const text = lang === 'ms'
      ? `${cap}. Memohon ${spec.title}.${when ? when.replace('Available from', ' Tersedia dari').replace(' to ', ' hingga ') : ''}`
      : `${cap}. Applying for ${spec.title}.${when}`
    summary = { text, factIds: [e0.fact_id] }
  }

  return {
    schema: 1, language: opts.language ?? 'en', target: { company: D(spec.company), role: D(spec.title) },
    header: { name: D(id.fullName) || profile.name, contacts }, summary, sections, changelog: log,
  }
}

// ------------------------------------------------------------------ cover letter (deterministic, evidence-only)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const longDate = (d = new Date()) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
const listJoin = (xs: string[], and = 'and') => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs.at(-1)}`

export function buildLetter(profile: Profile, allFacts: Fact[], spec: JobSpec, ctx: { company: string; role: string; careerType: 'INTERNSHIP' | 'GRADUATE'; language?: 'en' | 'ms'; recipientLines?: string[]; now?: Date }): LetterAST {
  const facts = allFacts.filter((f) => f.confirmed)
  const ms = ctx.language === 'ms'
  const wanted = new Set([...spec.required, ...spec.preferred])
  const edu = facts.find((f) => f.category === 'EDUCATION')
  const work = facts.filter((f) => ['PROJECT', 'EXPERIENCE'].includes(f.category)).map((f) => ({ f, ...relevance(f, wanted) })).sort((a, b) => b.count - a.count)
  const top = work[0], second = work[1]
  const name = D(profile.identity.fullName) || profile.name
  const p = profile.prefs
  const uni = D(edu?.organization)
  const lang: 'en' | 'ms' = ms ? 'ms' : 'en'
  const phrase = rolePhrase(ctx.role, ctx.careerType, lang)
  const matchedTech = top?.overlap.length ? top.overlap.slice(0, 3) : (top?.f.tools.slice(0, 3) ?? [])
  const when = ctx.careerType === 'INTERNSHIP' && p.internshipStart ? (ms ? ` Saya tersedia mulai ${p.internshipStart}${p.internshipEnd ? ` hingga ${p.internshipEnd}` : ''}.` : ` I am available from ${p.internshipStart}${p.internshipEnd ? ` to ${p.internshipEnd}` : ''}.`) : ''
  const para: LetterAST['paragraphs'] = []
  const add = (text: string, factIds: string[]) => para.push({ id: nid('lp'), text, factIds })

  const eduBit = edu ? eduClause(edu, lang, ctx.now) : (ms ? 'seorang pemohon' : 'an applicant')
  add(ms
    ? `Saya ingin memohon ${phrase} di ${ctx.company}. Saya ${eduBit}${matchedTech.length ? ` dan kerja terkini saya melibatkan ${listJoin(matchedTech, 'dan')}` : ''}.${when}`
    : `I am writing to apply for the ${phrase} at ${ctx.company}. I am ${eduBit}${matchedTech.length ? `, and my recent work has used ${listJoin(matchedTech)}` : ''}.${when}`,
    [edu?.fact_id, top?.f.fact_id].filter(Boolean) as string[])

  if (top) {
    const bl = bulletsOf(top.f).slice(0, 2).map((b, i) => (i ? lcFirst(b) : b).replace(/[.\s]+$/, ''))
    const tools = top.f.tools.length ? ` (${top.f.tools.slice(0, 5).join(', ')})` : ''
    add(ms
      ? `Projek yang paling berkaitan ialah "${top.f.title}"${tools}. ${bl.length ? bl.join('; ') + '.' : ''}`
      : `The closest match to this role is my ${top.f.category === 'PROJECT' ? 'project' : 'work'} "${top.f.title}"${tools}. ${bl.length ? bl.join('; ') + '.' : ''}`, [top.f.fact_id])
  }
  if (second) {
    const bl = bulletsOf(second.f).slice(0, 1).map((b) => b.replace(/[.\s]+$/, ''))
    add(ms
      ? `Saya juga mempunyai pengalaman melalui "${second.f.title}"${bl.length ? `: ${bl[0]}` : ''}.`
      : `I also gained relevant experience through "${second.f.title}"${bl.length ? `: ${bl[0]}` : ''}.`, [second.f.fact_id])
  }
  add(ms
    ? `Resume saya dilampirkan. Saya berbesar hati untuk berbincang lanjut mengenai peranan ini. Terima kasih atas masa dan pertimbangan tuan/puan.`
    : `My resume is attached. I would welcome the chance to discuss the role and how I could contribute. Thank you for your time and consideration.`, [])

  const lines = [profile.identity.email, profile.identity.phone, profile.identity.location && tidyText(profile.identity.location), profile.identity.linkedin && shortUrl(profile.identity.linkedin)].filter(Boolean) as string[]
  return {
    schema: 1, language: ms ? 'ms' : 'en', target: { company: ctx.company, role: ctx.role },
    sender: { name, lines }, date: longDate(ctx.now), recipient: ctx.recipientLines?.length ? ctx.recipientLines : [ms ? 'Pengurus Pengambilan / Jabatan Sumber Manusia' : 'Hiring Team', ctx.company],
    subject: ms ? `Permohonan ${phrase}` : `Application for ${INTERNISH.test(ctx.role) ? ctx.role : ctx.careerType === 'INTERNSHIP' ? `${ctx.role} Internship` : ctx.role}`,
    salutation: ms ? 'Tuan/Puan,' : 'Dear Hiring Team,', paragraphs: para, closing: ms ? 'Yang benar,' : 'Sincerely,', signature: name,
  }
}

// ------------------------------------------------------------------ fact check gate
export interface FactIssue { severity: 'error' | 'warn'; where: string; text: string; message: string }
export interface FactCheckResult { passed: boolean; issues: FactIssue[]; checkedClaims: number }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const corpusOf = (fs: Fact[]) => norm(fs.map((f) => [f.title, f.organization, f.claim_text, f.tools.join(' '), f.metrics.join(' '), f.date_start, f.date_end].join(' ')).join(' \n '))
const compact = (s: string) => norm(s).replace(/\s/g, '')

const NUM_CLAIMS = /(\b\d+(?:\.\d+)?\s?(?:%|×|x\b)|\b\d[\d,]*\+?\s?(?:users|clients|customers|requests|records|students|participants|downloads|stars|endpoints|tests|rows|transactions)\b|\bRM\s?\d[\d,.]*|\b\d+\+?\s?(?:years?|yrs)\b|\b\d+\s?(?:ms|seconds?)\b)/gi

export function factCheckText(text: string, facts: Fact[], opts: { where: string; allowedStrings?: string[]; scope?: Fact[] }): FactIssue[] {
  const issues: FactIssue[] = []
  let t = text
  for (const a of opts.allowedStrings ?? []) if (a) t = t.split(a).join(' ')
  const scope = opts.scope?.length ? opts.scope : facts
  const techAll = new Set(facts.flatMap((f) => [...factTechSet(f)]))
  const corpus = compact(corpusOf(scope))
  for (const tech of findTech(t)) {
    if (!techAll.has(tech)) issues.push({ severity: 'error', where: opts.where, text: tech, message: `"${tech}" is not in your confirmed facts, so it cannot appear in this document.` })
  }
  for (const m of t.match(NUM_CLAIMS) ?? []) {
    if (!corpus.includes(compact(m))) issues.push({ severity: 'error', where: opts.where, text: m, message: `The figure "${m}" is not in the source fact(s). Invented metrics are blocked.` })
  }
  return issues
}

export function factCheckResume(ast: ResumeAST, allFacts: Fact[]): FactCheckResult {
  const facts = allFacts.filter((f) => f.confirmed)
  const byId = new Map(facts.map((f) => [f.fact_id, f]))
  const issues: FactIssue[] = []
  let n = 0
  const allowed = [ast.target.role, ast.target.company]
  if (ast.summary) { n++; issues.push(...factCheckText(ast.summary.text, facts, { where: 'Profile line', allowedStrings: allowed })) }
  const kindNeedsSource = (k: ResumeSection['kind']) => ['projects', 'experience', 'leadership'].includes(k)
  const skillVals = new Set(facts.filter((f) => f.category === 'SKILL' || f.category === 'LANGUAGE').flatMap((f) => f.tools.map(norm)))
  for (const s of ast.sections) {
    for (const g of s.skillGroups ?? []) for (const v of g.values) {
      n++
      if (!skillVals.has(norm(v))) issues.push({ severity: 'error', where: s.title, text: v, message: `Skill "${v}" is not in your confirmed skills.` })
    }
    for (const it of s.items ?? []) {
      for (const fid of it.factIds) if (!byId.has(fid)) issues.push({ severity: 'error', where: `${s.title} › ${it.heading}`, text: it.heading, message: `This entry cites a fact (${fid}) that is not confirmed in your profile.` })
      for (const b of it.bullets) {
        n++
        const where = `${s.title} › ${it.heading}`
        const src = b.sourceFactIds.map((i) => byId.get(i)).filter(Boolean) as Fact[]
        if (kindNeedsSource(s.kind) && !src.length) { issues.push({ severity: 'error', where, text: b.text, message: 'This achievement has no source fact, so it cannot be verified.' }); continue }
        issues.push(...factCheckText(b.text, facts, { where, scope: src }))
      }
    }
  }
  return { passed: !issues.some((i) => i.severity === 'error'), issues, checkedClaims: n }
}

export function factCheckLetter(letter: LetterAST, allFacts: Fact[]): FactCheckResult {
  const facts = allFacts.filter((f) => f.confirmed)
  const issues: FactIssue[] = []
  const allowed = [letter.target.role, letter.target.company, letter.subject]
  for (const p of letter.paragraphs) {
    const scope = p.factIds.map((i) => facts.find((f) => f.fact_id === i)).filter(Boolean) as Fact[]
    issues.push(...factCheckText(p.text, facts, { where: 'Cover letter', allowedStrings: allowed, scope }))
  }
  return { passed: !issues.some((i) => i.severity === 'error'), issues, checkedClaims: letter.paragraphs.length }
}

export function resumeText(ast: ResumeAST): string {
  const out: string[] = [ast.header.name, ast.header.contacts.map((c) => c.text).join(' | ')]
  if (ast.summary) out.push(ast.summary.text)
  for (const s of ast.sections) {
    out.push(s.title)
    for (const g of s.skillGroups ?? []) out.push(`${g.label}: ${g.values.join(', ')}`)
    for (const it of s.items ?? []) { out.push([it.heading, it.dates].filter(Boolean).join(' ')); if (it.subheading) out.push(it.subheading); for (const b of it.bullets) out.push(b.text) }
  }
  return out.join('\n')
}

/** Per-bullet diff against the master fact wording. */
export function diffVsMaster(ast: ResumeAST) {
  const rows: { section: string; item: string; bulletId: string; text: string; original: string; status: 'verbatim' | 'edited'; factIds: string[] }[] = []
  for (const s of ast.sections) for (const it of s.items ?? []) for (const b of it.bullets)
    rows.push({ section: s.title, item: it.heading, bulletId: b.id, text: b.text, original: b.original, status: b.text === b.original ? 'verbatim' : 'edited', factIds: b.sourceFactIds })
  return rows
}

export const TECH_COUNT = TECH_NAMES.length
export const fileSlug = (s: string) => slugify(s, 24)
