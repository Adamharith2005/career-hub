import type { FactCategory } from './profiles.ts'
import { findTech } from './domain.ts'

/**
 * Category-boundary rules. A "skill" is a short technology / tool / competency name — never a section heading,
 * a date, a sentence or an activity. These checks run at the parser, on manual entry and again before documents are built.
 */

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DATEY = new RegExp(`(?:\\b${MONTH}\\.?\\s+\\d{4}\\b|\\b\\d{1,2}/\\d{4}\\b|\\b(?:19|20)\\d{2}\\s*(?:-|–|—|to)\\s*(?:(?:19|20)\\d{2}|present|current|now|ongoing)\\b|^(?:19|20)\\d{2}$)`, 'i')

/** Words that make a string a section heading rather than a skill. */
const HEADING_WORDS = /^(?:activities|involvement|leadership|extracurricular|co-?curricular|volunteer(?:ing)?|education|academic|experience|employment|projects?|awards?|honou?rs|achievements?|certifications?|references?|summary|profile|objective|interests?|declaration|publications?|training|courses?)\b/i

export const stripBulletGlyph = (s: string) =>
  s.replace(/^[\s ]*(?:[•\-–—·*▪●◦■►▶✓✔→>?]|[-�]|•)[\s ]*/u, '').replace(/[-�]/g, '').trim()

/** Is this line an unrecognised section heading (ALL CAPS, short, no digits/sentence punctuation)? */
export function looksLikeHeading(line: string): boolean {
  const t = line.replace(/[:：_*#=\-–—|]+$/g, '').trim()
  if (t.length < 3 || t.length > 48) return false
  if (/[a-z]/.test(t)) return false
  if (/\d|@|,|\./.test(t)) return false
  return /[A-Z]/.test(t) && t.split(/\s+/).length <= 6
}

export function skillProblem(item: string): string | null {
  const t = item.trim()
  if (!t) return 'empty'
  if (t.length > 40) return 'too long to be a skill'
  if (DATEY.test(t)) return 'looks like a date'
  if (HEADING_WORDS.test(t)) return 'looks like a section heading'
  if (looksLikeHeading(t) && /&|\band\b/i.test(t)) return 'looks like a section heading'
  if (t.split(/\s+/).length > 5) return 'looks like a sentence'
  if (/[.!?]$/.test(t) && t.split(/\s+/).length > 2) return 'looks like a sentence'
  if (/^[?�\s]+$/.test(t)) return 'not a skill'
  return null
}
export const isPlausibleSkill = (s: string) => skillProblem(s) === null

export function cleanSkillItems(items: string[]): { kept: string[]; rejected: { item: string; reason: string }[] } {
  const kept: string[] = [], rejected: { item: string; reason: string }[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const item = stripBulletGlyph(raw)
    const why = skillProblem(item)
    if (why) { if (item) rejected.push({ item, reason: why }); continue }
    const k = item.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k); kept.push(item)
  }
  return { kept, rejected }
}

/** Group labels a student CV legitimately uses for skills. Anything else (e.g. "Procurement") must prove itself by containing a recognised technology. */
const KNOWN_GROUP = /^(?:programming |spoken |technical |professional |core |key |other |additional )?(?:languages?|frameworks?|libraries|tools?|technolog(?:y|ies)|databases?|data(?: (?:science|analysis|analytics|tools?))?|ai(?: ?\/ ?ml)?|machine learning|cloud(?: (?:&|and) devops)?|devops|security(?: tools?)?|cyber ?security|networking|operating systems?|os|platforms?|web|mobile|backend|frontend|front-end|back-end|testing|qa|methodolog(?:y|ies)|version control|soft skills?|collaboration|communication|skills?|competenc(?:y|ies)|software|hardware|ides?|others?)(?: ?(?:&|and|\/) ?\w[\w ]*)?$/i
export const isKnownSkillGroup = (label: string) => KNOWN_GROUP.test(label.trim())
/** A group is real if its label is a known skill category, or it contains at least one recognised technology. */
export const isRealSkillGroup = (label: string, items: string[]) => isKnownSkillGroup(label) || items.some((i) => findTech(i).length > 0)

/** A skill-group label like "Languages" — must itself not be a heading/date/sentence. */
export const isPlausibleGroupLabel = (s: string) => {
  const t = s.trim()
  return t.length >= 2 && t.length <= 40 && !DATEY.test(t) && !HEADING_WORDS.test(t) && t.split(/\s+/).length <= 4
}

export interface IntegrityIssue { factId?: string; field: string; message: string }

export interface FactLike {
  fact_id?: string; category: FactCategory; title: string; organization?: string | null
  claim_text?: string; tools?: string[]; date_start?: string | null; date_end?: string | null
}

/** Validate one record against its category. Pure; returns human-readable issues (empty = fine). */
export function validateFact(f: FactLike): IntegrityIssue[] {
  const out: IntegrityIssue[] = []
  const add = (field: string, message: string) => out.push({ factId: f.fact_id, field, message })
  const title = (f.title ?? '').trim()
  if (!title) add('title', 'Give this entry a name.')
  if (f.category === 'SKILL') {
    if (!isPlausibleGroupLabel(title)) add('title', `"${title}" doesn't look like a skill category (try Languages, Frameworks, Tools…).`)
    for (const t of f.tools ?? []) { const p = skillProblem(t); if (p) add('tools', `"${t}" can't be a skill: it ${p}.`) }
    if (!(f.tools ?? []).length) add('tools', 'Add at least one skill.')
    else if (isPlausibleGroupLabel(title) && !isRealSkillGroup(title, f.tools ?? [])) add('title', `"${title}" isn't a skill category. Use Languages, Frameworks, Tools, Databases… — activities and experience belong in their own sections.`)
  } else if (f.category !== 'LANGUAGE' && f.category !== 'LINK') {
    if (DATEY.test(title) && title.replace(DATEY, '').trim().length < 3) add('title', 'The name looks like a date. Put dates in the date fields.')
    if (/^[?�\s]+$/.test(title)) add('title', 'The name is empty or unreadable.')
  }
  return out
}

/** Audit a whole profile: used by the UI ("needs review") and by tests. Never mutates anything. */
export function auditFacts(facts: (FactLike & { fact_id: string })[]): IntegrityIssue[] {
  return facts.flatMap(validateFact)
}

/** Remove glyph noise from free text lines (orphan "?" bullets etc). */
export const cleanLine = (s: string) => stripBulletGlyph(s).replace(/\s+/g, ' ').trim()
