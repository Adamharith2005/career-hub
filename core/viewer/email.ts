/**
 * The one internship email generator. Offline, deterministic, no network, no API key.
 * Structure (official Career Hub standard): greeting; introduction with role and confirmed availability; one paragraph of
 * relevant strengths with a project and a leadership example; attachments and closing; signature.
 * Only verified profile facts are used. Dates, programme and documents appear only when they are confirmed or selected.
 */
import type { CatalogCompany } from './catalog.ts'
import type { Profile, ProjectRecord } from './store.ts'
import { roleNeeds, studentCredit, projectWeight, defaultRole, ROLE_LABEL, type RoleFamily, type StudentFacts } from './suitability.ts'
import { conceptsIn } from './suitability.ts'

export type AttachmentKind = 'RESUME' | 'CV' | 'COVER_LETTER' | 'REFERRAL_LETTER'
export interface Draft { to: string | null; toNote: string; subject: string; body: string; roleTitle: string; field: string; role: RoleFamily; speculative: boolean; attachments: AttachmentKind[]; words: number }
export interface DraftOptions { role?: RoleFamily | null; attachments?: AttachmentKind[]; includeAvailability?: boolean }

const AREA: Record<RoleFamily, string> = {
  DATA_ANALYTICS: 'data analytics', DATA_SCIENCE_ML: 'data science and machine learning', DATA_ENGINEERING: 'data engineering', AI_INTEGRATION: 'artificial intelligence',
  SOFTWARE: 'software engineering', FULL_STACK: 'full-stack software development', CYBERSECURITY: 'cybersecurity', CLOUD_DEVOPS: 'cloud engineering', INFO_SYSTEMS: 'enterprise information systems',
}
const DEFAULT_TITLE: Record<RoleFamily, string> = {
  DATA_ANALYTICS: 'Data Analyst', DATA_SCIENCE_ML: 'Machine Learning', DATA_ENGINEERING: 'Data Engineering', AI_INTEGRATION: 'AI Integration', SOFTWARE: 'Software Engineering',
  FULL_STACK: 'Full-Stack Development', CYBERSECURITY: 'Cybersecurity', CLOUD_DEVOPS: 'Cloud Engineering', INFO_SYSTEMS: 'Information Systems',
}
const TITLE_RE: Record<RoleFamily, RegExp> = {
  DATA_ANALYTICS: /data analy|business intelligence|\bbi\b|analytics/i, DATA_SCIENCE_ML: /machine learning|data scien|\bml\b/i, DATA_ENGINEERING: /data engineer/i, AI_INTEGRATION: /\bai\b|artificial/i,
  SOFTWARE: /software|developer|back-?end|front-?end|\bqa\b/i, FULL_STACK: /full-?stack|web/i, CYBERSECURITY: /cyber|security|\bsoc\b/i, CLOUD_DEVOPS: /cloud|devops|\bsre\b/i, INFO_SYSTEMS: /information system|business analyst|it systems|\berp\b/i,
}
/** What the student can honestly say they have done, per role family. Each phrase needs real evidence for its concept. */
const EXPERIENCE: Record<RoleFamily, [string, string][]> = {
  DATA_ANALYTICS: [['etl', 'data cleaning'], ['stats', 'statistical analysis'], ['ml', 'machine learning'], ['bi', 'dashboard development']],
  DATA_SCIENCE_ML: [['etl', 'data cleaning'], ['ml', 'predictive modelling'], ['stats', 'statistical analysis'], ['dataviz', 'data visualisation']],
  DATA_ENGINEERING: [['bigdata', 'Hive and Hadoop analytics'], ['sql', 'SQL querying'], ['etl', 'data processing']],
  AI_INTEGRATION: [['llm', 'Gemini API integration'], ['ml', 'machine learning'], ['backend', 'API development']],
  SOFTWARE: [['webapp', 'web application development'], ['backend', 'API development'], ['dbdesign', 'database design']],
  FULL_STACK: [['webapp', 'web application development'], ['backend', 'API development'], ['dbdesign', 'database design']],
  CYBERSECURITY: [['security', 'cloud security analysis'], ['iac', 'infrastructure as code'], ['cloud', 'cloud services']],
  CLOUD_DEVOPS: [['cloud', 'cloud services'], ['iac', 'infrastructure as code'], ['devops', 'deployment workflows']],
  INFO_SYSTEMS: [['dbdesign', 'database design'], ['analysis', 'inventory and information systems'], ['webapp', 'web application development']],
}
const BI_FIRST: [string, string][] = [['bi', 'dashboard development'], ['etl', 'data cleaning'], ['stats', 'statistical analysis'], ['sql', 'data modelling']]

const list = (a: string[]) => a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`
const lc = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length
const facts = (p: Profile) => p as unknown as StudentFacts

export function roleTitleFor(role: RoleFamily, c: CatalogCompany, advertised: boolean): string {
  // Use the organisation's own wording only for an advertised role; otherwise a plain, honest title.
  const own = advertised ? c.roles.find((r) => TITLE_RE[role].test(r)) : undefined
  const raw = own ?? DEFAULT_TITLE[role]
  return raw.replace(/\s*Intern(ship)?s?$/i, '').trim()
}

function degreeLine(p: Profile): string {
  const spec = /\(([^)]+)\)/.exec(p.degree)?.[1] ?? p.specialisation
  const year = p.availability?.confirmed && p.availability.studyYear ? `${p.availability.studyYear} ` : ''
  return `${year}Computer Science (${spec}) student at ${p.university}`
}

function availabilitySentence(p: Profile, on: boolean): string {
  const a = p.availability
  if (!on || !a?.confirmed) return ''
  const when = a.start && a.end ? ` from ${a.start} to ${a.end}` : a.start ? ` from ${a.start}` : ''
  if (!when && !a.duration) return ''
  const dur = a.duration ? `a ${a.duration} internship` : 'an internship'
  const lead = a.programme ? `Under my university's ${a.programme} programme, ` : ''
  const core = `I am available for ${dur}${when}`
  return `${lead}${lead ? core : core.replace(/^I am/, 'I am')}${a.detail ? `, ${a.detail}` : ''}.`
}

function pickSkills(p: Profile, role: RoleFamily): string[] {
  const credit = studentCredit(facts(p))
  const out: string[] = []
  // Tools and platforms only. Techniques such as regression or analysis are described in the experience phrase.
  const TECHNIQUE = new Set(['ml', 'stats', 'analysis', 'etl', 'dataviz', 'webapp', 'security', 'network', 'dbdesign'])
  for (const [k] of [...roleNeeds(role)].sort((a, b) => b[1] - a[1])) {
    if (TECHNIQUE.has(k)) continue
    const c = credit.get(k); if (!c || c.credit < 1 || !c.source.startsWith('Skill:')) continue
    const item = c.source.replace(/^Skill:\s*/, '').replace(/\s*\(.*?\)\s*$/, '').split(/, | and /)[0].trim()
    if (item && !out.some((x) => x.toLowerCase() === item.toLowerCase())) out.push(item)
    if (out.length === 3) break
  }
  return out
}

function experienceList(p: Profile, role: RoleFamily, roleTitle: string): string[] {
  const credit = studentCredit(facts(p))
  const table = role === 'DATA_ANALYTICS' && /business intelligence|\bbi\b/i.test(roleTitle) ? BI_FIRST : EXPERIENCE[role]
  return table.filter(([k]) => (credit.get(k)?.credit ?? 0) >= 0.7).map(([, t]) => t).slice(0, 4)
}
const experiencePhrase = (got: string[]) => (got.length ? `with hands-on experience in ${list(got)}` : '')

/** Technical closing used instead of a leadership example. Wording differs by role and uses only evidenced experience. */
function technicalClose(role: RoleFamily, got: string[], skills: string[], proj: ProjectRecord | null, c: CatalogCompany, field: string): string {
  const lead = got[0]
  const w = 'while continuing to develop my technical skills'
  switch (role) {
    case 'SOFTWARE': return lead ? `I would welcome the opportunity to apply my hands-on experience in ${lead} and contribute to your ${field} team ${w}.` : `I would welcome the opportunity to contribute to your ${field} team ${w}.`
    case 'FULL_STACK': return skills.length ? `I would welcome the opportunity to build on my ${list(skills.slice(0, 2))} work with your development team and learn from your engineers.` : `I would welcome the opportunity to learn from your development team.`
    case 'CYBERSECURITY': return lead ? `I would welcome the chance to apply my ${lead} to your security work at ${c.name} and learn from your team.` : `I would welcome the chance to learn from the security team at ${c.name}.`
    case 'CLOUD_DEVOPS': return lead ? `I would be glad to bring my experience with ${lead} to your cloud engineering work and learn how your team runs it in practice.` : `I would be glad to learn from your cloud engineering team.`
    case 'AI_INTEGRATION': return lead ? `I would welcome the opportunity to apply my experience in ${lead} to your AI work and keep learning from your team.` : `I would welcome the opportunity to learn from your AI team.`
    case 'INFO_SYSTEMS': return lead ? `I would be glad to apply my experience in ${lead} to your enterprise systems work and learn how your team supports it.` : `I would be glad to learn how your team builds and supports enterprise systems.`
    default: return proj ? `I would welcome the opportunity to apply the skills I developed on this work to your ${field} projects and learn from your team.` : `I would welcome the opportunity to learn from your ${field} team.`
  }
}

export function pickProject(p: Profile, role: RoleFamily): ProjectRecord | null {
  const needs = roleNeeds(role); const tot = needs.reduce((a, [, w]) => a + w, 0)
  let best: { x: ProjectRecord; r: number } | null = null
  for (const x of p.projects) {
    if (x.contribution === 'TEAM_UNCERTAIN') continue
    const ks = new Set(conceptsIn([x.title, ...x.stack].join(' ')))
    const rel = needs.reduce((a, [k, w]) => a + (ks.has(k) ? w : 0), 0) / tot + (x.themes?.includes(role) ? 0.25 : 0)
    const r = rel * (0.5 + 0.5 * projectWeight(x))
    if (r > 0.05 && (!best || r > best.r)) best = { x, r }
  }
  return best?.x ?? null
}
function projectPhrase(x: ProjectRecord): string {
  if (x.emailName) return x.emailName
  const team = /team/i.test(x.context) ? ' team' : ''
  if (x.status === 'PROPOSED' || x.status === 'IN_PROGRESS') return `my in-progress ${/final year/i.test(x.context) ? 'final year project, ' : 'project, '}${x.title.replace(/\s+with AI-Assisted Remediation/i, '')}`
  return `my ${x.title.split(' — ')[0]}${team} project`
}

function leadershipPhrase(p: Profile): string {
  const rows = [...p.leadership].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (/director/i.test(b.title) ? 1 : 0) - (/director/i.test(a.title) ? 1 : 0))
  const l = rows[0]; if (!l) return ''
  const org = l.organisation.replace(/\s*\(.*?\)\s*$/, '').trim().length > 40 || /\(MAGS\)/.test(l.organisation) ? (/\((\w+)\)/.exec(l.organisation)?.[1] ?? l.organisation) : l.organisation.replace(/\s*\(.*?\)\s*$/, '').trim()
  const t = l.title
  const verb = /^Head of (.+)$/i.exec(t) ? `leading ${/^Head of (.+)$/i.exec(t)![1].toLowerCase()} for ${org}` : /Deputy (Director|Treasurer)/i.test(t) ? `serving as ${t.replace(/,.*$/, '')} for ${org}` : /Committee Member/i.test(t) ? `serving on the sponsorship committee for ${org}` : `${lc(t)} for ${org}`
  return `Outside the classroom, ${verb} has strengthened my communication and teamwork skills.`
}

const ATTACH_ORDER: AttachmentKind[] = ['RESUME', 'CV', 'COVER_LETTER', 'REFERRAL_LETTER']
/** "my resume, cover letter and my faculty's Industrial Training referral letter": only the first item carries "my". */
export const attachmentSentence = (kinds: AttachmentKind[]): string => {
  const k = ATTACH_ORDER.filter((x) => kinds.includes(x)); if (!k.length) return ''
  const name: Record<AttachmentKind, string> = { RESUME: 'resume', CV: 'CV', COVER_LETTER: 'cover letter', REFERRAL_LETTER: "my faculty's Industrial Training referral letter" }
  const parts = k.map((x, i) => (i === 0 && x !== 'REFERRAL_LETTER' ? `my ${name[x]}` : name[x]))
  return `Please find attached ${list(parts)}.`
}

export function draftEmail(p: Profile, c: CatalogCompany, opts: DraftOptions = {}): Draft {
  const k = c.contacts
  const to = k.hrEmail ?? k.generalEmail ?? null
  const toNote = k.hrEmail ? 'Public HR email from the research file' : k.generalEmail ? 'General organisation email, not a confirmed recruitment address' : 'No verified public recruitment email available.'
  const role = opts.role ?? defaultRole(facts(p), c)
  // Only a verified current opening is an application. Historical, recurring or merely reported programmes are enquiries.
  const advertised = c.internship.evidence === 'ACTIVE_OPENING'
  const title = roleTitleFor(role, c, advertised)
  const field = AREA[role]
  const full = p.fullName || p.displayName
  const attachments = ATTACH_ORDER.filter((x) => (opts.attachments ?? []).includes(x))

  const ask = advertised ? `I would like to apply for the ${title} Internship at ${c.name}.` : `I am writing to enquire about potential internship opportunities in ${field} at ${c.name}.`
  const intro = [`I am a ${degreeLine(p)}, and ${ask}`, availabilitySentence(p, opts.includeAvailability ?? true)].filter(Boolean).join(' ')

  const skills = pickSkills(p, role)
  const gotExp = experienceList(p, role, title)
  const exp = experiencePhrase(gotExp)
  const proj = pickProject(p, role)
  const gpa = /CGPA[^0-9]*([0-4]\.\d{1,2})/i.exec(p.education.flatMap((e) => e.points).find((x) => /CGPA/i.test(x) && !/foundation/i.test(x)) ?? '')?.[1]
  const first = skills.length ? `I am skilled in ${list(skills)}${exp ? `, ${exp}` : ''}.` : exp ? `I have ${exp.replace(/^with /, '')}.` : ''
  const projectSentence = proj ? `Recent work includes ${projectPhrase(proj)}.` : ''
  const academic = gpa ? `I hold a CGPA of ${gpa}${p.academicHighlight ? ` and ${p.academicHighlight}` : ''}.` : ''
  const useLeadership = p.emailOptions?.leadership !== false
  const lead = useLeadership ? leadershipPhrase(p) : ''
  const where = c.industry && c.industry.length < 50 ? c.industry.replace(/\s*\/\s*/g, ' and ').split(' ').map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join(' ') : field
  const closer = useLeadership ? `I would be glad to bring these strengths to your team while learning from your work in ${where}.` : technicalClose(role, gotExp, skills, proj, c, field)
  const p2 = [first, projectSentence, academic, lead, closer].filter(Boolean).join(' ')

  const attach = attachmentSentence(attachments)
  const p3 = [attach, 'Thank you for your time and consideration. I look forward to hearing from you.'].filter(Boolean).join(' ')
  const sig = [`Yours sincerely,`, full, [p.contact.phone, p.contact.email].filter(Boolean).join(' | ')].filter(Boolean)
  const body = ['Dear Hiring Manager,', '', intro, '', p2, '', p3, '', ...sig].join('\n')
  const subject = advertised ? `Application for ${title} Internship — ${full}` : `Internship Enquiry — ${field.replace(/\b(?!and\b)\w/g, (m) => m.toUpperCase())} — ${full}`
  const words = wordCount(body.split('\n').slice(2, -3).join(' '))
  return { to, toNote, subject, body, roleTitle: title, field, role, speculative: !advertised, attachments, words }
}

export { ROLE_LABEL }
