import { findTech, roleLabel } from './domain.ts'
import type { Fact, Profile } from './profiles.ts'
import type { JobSpec } from './job.ts'
import type { ResumeAST } from './resume.ts'
import { targetFit, FAMILY_TECH, type TargetFit, type CompanyForFit } from './target.ts'
import { assess, type Assessment } from './fit.ts'

// ------------------------------------------------------------------ names
const LOWER = new Set(['bin', 'binti', 'bt', 'b', 'a/l', 'a/p', 'al', 'van', 'de'])
/** "ALEX TESTER BIN EXAMPLE" -> "Alex Tester bin Example" (never invents or drops a part). */
export const titleName = (n: string) => n.trim().split(/\s+/).map((w, i) => (i > 0 && LOWER.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ')

// ------------------------------------------------------------------ route
export type EmailRoute = 'VACANCY' | 'SPECULATIVE' | 'ENQUIRY_DOCUMENTED' | 'ENQUIRY_PORTAL'
export interface Recipient {
  kind: 'HR' | 'GENERAL' | 'NONE'
  address: string | null
  label: string                 // honest, user-facing description of where the address came from
  careersUrl: string | null
  websiteUrl: string | null
  instructions: string          // copyable plain-text application instructions (always present)
}
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/
const cleanUrl = (u?: string | null) => { const t = (u ?? '').trim(); return !t || /^unknown$/i.test(t) ? null : (/^https?:\/\//i.test(t) ? t : `https://${t}`) }
/** Seed contact cells sometimes hold "a@x.com / b@x.com" or "Contact form via x.com (+603…)". Only a clean single address is ever used; nothing is guessed. */
export function firstAddress(cell?: string | null): string | null {
  for (const part of (cell ?? '').split(/[\s/,;]+/)) { const p = part.trim().replace(/[()<>]/g, ''); if (EMAIL_RE.test(p)) return p }
  return null
}
export function recipientFor(c: { name: string; hr_email?: string | null; general_contact?: string | null; careers_page?: string | null; website?: string | null; last_verified?: string | null; recommended_method?: string | null }, roleTitle: string, who: { resumeName: string; cvName: string }): Recipient {
  const hr = firstAddress(c.hr_email), gen = hr ? null : firstAddress(c.general_contact)
  const careers = cleanUrl(c.careers_page), site = cleanUrl(c.website)
  const addr = hr ?? gen
  const seen = c.last_verified ? ` (seed research, ${c.last_verified})` : ''
  const steps = [
    careers ? `1. Open the official careers page: ${careers}` : site ? `1. No careers page is recorded. Open the official website: ${site} and look for Careers / Contact.` : '1. No careers page or website is recorded for this company. Check its LinkedIn page or contact details before applying.',
    `2. Look for an internship or "${roleTitle}" listing in Cyberjaya. If none is listed, use the company's contact form or the email wording below as an enquiry.`,
    `3. Upload ${who.resumeName} (and ${who.cvName} if a CV is requested). Attach them yourself; Career Hub never sends or attaches anything.`,
    '4. Mark the application as applied in Career Hub only after you have actually submitted it.',
  ].join('\n')
  if (addr) return { kind: hr ? 'HR' : 'GENERAL', address: addr, label: hr ? `Public HR / recruitment email${seen}` : `Public company contact${seen}. Not a dedicated HR address`, careersUrl: careers, websiteUrl: site, instructions: steps }
  return { kind: 'NONE', address: null, label: 'No verified public email. Apply through the official route below', careersUrl: careers, websiteUrl: site, instructions: steps }
}

export function routeFor(status: string | null | undefined, hasAd: boolean, rec: Recipient): EmailRoute {
  if (hasAd) return 'VACANCY'
  if (status === 'VERIFIED_ACTIVE_VACANCY' || status === 'DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING') return 'ENQUIRY_DOCUMENTED'
  if (status === 'PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK') return 'ENQUIRY_PORTAL'
  return 'SPECULATIVE'
}

// ------------------------------------------------------------------ evidence picking
const confirmed = (fs: Fact[]) => fs.filter((f) => f.confirmed)
const firstBullet = (f: Fact) => f.claim_text.split('\n').map((s) => s.trim()).find((l) => l && !/^\(.*\)$/.test(l)) ?? ''
const sentence = (s: string) => { const t = s.trim().replace(/\s+/g, ' '); return /[.!?]$/.test(t) ? t : `${t}.` }
const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

/** Rank projects by overlap with the technologies/family the target implies. Pure; never adds anything the profile lacks. */
export function pickProject(facts: Fact[], wanted: Set<string>, family: string, famOf: (f: Fact) => string[]): { fact: Fact; overlap: string[] } | null {
  const ps = confirmed(facts).filter((f) => f.category === 'PROJECT')
  const scored = ps.map((f) => {
    const techs = findTech([f.title, f.claim_text, f.tools.join(' ')].join('\n'))
    const overlap = techs.filter((t) => wanted.has(t))
    const fam = famOf(f).includes(family) ? 1 : 0
    const proposalPenalty = f.maturity === 'proposal' ? 0.5 : 0   // equal relevance: prefer demonstrated work over a proposal
    return { fact: f, overlap, s: overlap.length + fam * 1.5 - proposalPenalty }
  }).sort((a, b) => b.s - a.s)
  return scored[0] ?? null
}

export interface MailCtx {
  profile: Profile; facts: Fact[]; company: string; industry?: string | null; role: string; roleFamily: string; route: EmailRoute
  wanted: Set<string>; spec?: Pick<JobSpec, 'required' | 'preferred'> | null; famOf: (f: Fact) => string[]
}
export interface MailDraft { subject: string; body: string; usedFactIds: string[]; notes: string[] }

export function buildPackEmail(c: MailCtx): MailDraft {
  const id = c.profile.identity
  const name = titleName(id.fullName || c.profile.name)
  const facts = confirmed(c.facts)
  const edu = facts.find((f) => f.category === 'EDUCATION' && f.details?.level === 'bachelor') ?? facts.find((f) => f.category === 'EDUCATION')
  const uni = edu?.organization?.split(',')[0]?.trim() ?? ''
  const degree = edu?.title ?? ''
  const pr = c.profile.prefs
  const when = pr.internshipStart ? `${pr.internshipStart}${pr.internshipEnd ? ` to ${pr.internshipEnd}` : ''}` : ''
  const months = (() => {
    const m = (s?: string) => { const d = new Date(`1 ${s}`); return Number.isNaN(d.getTime()) ? null : d.getFullYear() * 12 + d.getMonth() }
    const a = m(pr.internshipStart), b = m(pr.internshipEnd); return a != null && b != null && b > a ? b - a : null
  })()
  const availability = when ? `I am available for ${months ? `a ${months}-month ` : 'an '}internship from ${when}.` : 'I can confirm my exact internship dates when you tell me what suits your team.'
  const notes: string[] = []
  if (!when) notes.push('No internship dates are on this profile, so the email uses a generic availability sentence. Add confirmed dates in My Profile when known.')

  const area = c.role.replace(/\b(intern(ship)?|trainee)\b/gi, '').replace(/\s{2,}/g, ' ').replace(/[-–,]\s*$/, '').trim() || (c.roleFamily !== 'other' ? roleLabel(c.roleFamily) : c.role)
  const pick = pickProject(facts, c.wanted, c.roleFamily, c.famOf)
  const used: string[] = []
  if (edu) used.push(edu.fact_id)
  let project = ''
  if (pick) {
    const f = pick.fact; used.push(f.fact_id)
    const ctx = f.details?.context ? ` (${f.details.context})` : ''
    if (f.maturity === 'proposal') {
      const l = firstBullet(f).replace(/^Proposed:\s*/i, '')
      project = `My final-year project is still in progress (expected March 2027). It proposes ${lcFirst(sentence(l))} It is a proposal and design, not a finished system.`
    } else {
      const team = /team/i.test(f.details?.context ?? '') || /^Team project:/i.test(firstBullet(f))
      const b = firstBullet(f).replace(/^Team project:\s*/i, '')
      const verb = /^(Built|Led|Wrote|Found|[A-Z][a-z]+ed)\b/.test(b)
      const what = verb ? `${team ? 'As part of the team, I' : 'I'} ${lcFirst(b)}` : `The project is ${lcFirst(b)}`
      const via = pick.overlap.length ? ` It overlaps with this role through ${pick.overlap.slice(0, 3).join(', ')}.` : ''
      project = `One relevant project is ${f.title}${ctx}. ${sentence(what)}${via}`
    }
  }
  // Tools: only ones the profile lists AND the role context points to; else the first skill group. Never invented.
  const profSkills = facts.filter((f) => f.category === 'SKILL').flatMap((f) => f.tools)
  const relTools = profSkills.filter((t) => findTech(t).some((x) => c.wanted.has(x)))
  // Only mention tools when at least one is relevant to this role; fill to 4 from the profile's own list. Never list unrelated tools to look busy.
  const tools = relTools.length ? [...new Set([...relTools, ...profSkills])].slice(0, 4) : []
  const toolLine = tools.length ? `I work with ${tools.join(', ')}.` : ''

  const adMatch = c.spec ? [...new Set([...(c.spec.required ?? []), ...(c.spec.preferred ?? [])])].filter((t) => profSkills.some((s) => findTech(s).includes(t))).slice(0, 4) : []
  const industry = (c.industry ?? '').trim()
  const parts = industry.split(/\s*\/\s*/).filter(Boolean)
  const indList = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? ''
  const interest = industry ? `I am interested in ${c.company} because of its work in ${indList}.` : ''
  const who = `${degree ? `a ${degree} student` : 'a student'}${uni ? ` at ${uni}` : ''}`

  let subject = '', opener = '', closer = ''
  const short = (s?: string) => (s ?? '').replace(/^(\w{3})\w*/, '$1')
  const dates = when ? ` (${short(pr.internshipStart)}${pr.internshipEnd ? ` - ${short(pr.internshipEnd)}` : ''})` : ''
  const sig = [name, [id.phone, id.email].filter(Boolean).join(' | '), id.github ?? id.linkedin].filter(Boolean).join('\n')
  if (c.route === 'VACANCY') {
    subject = `Internship Application: ${c.role}${dates} - ${name}${uni ? `, ${uni}` : ''}`
    opener = `I am applying for the ${c.role} internship at ${c.company}. I am ${who}.`
    if (adMatch.length) notes.push(`Matched against the pasted job description: ${adMatch.join(', ')}.`)
  } else {
    subject = `Internship Enquiry: ${area}${dates} - ${name}${uni ? `, ${uni}` : ''}`
    const why = c.route === 'ENQUIRY_DOCUMENTED' ? `I understand ${c.company} has offered internships before, so I am writing to ask whether you are currently accepting applications for ${area}.`
      : c.route === 'ENQUIRY_PORTAL' ? `I could not confirm an internship track on ${c.company}'s careers page, so I am writing to ask whether interns are accepted in ${area}.`
      : `I am writing to ask whether ${c.company} takes interns in ${area}. I understand there may be no advertised opening, so this is an enquiry only.`
    opener = `I am ${who}. ${why}`
  }
  closer = c.route === 'VACANCY' ? 'My resume and CV (PDF) are attached. I would be glad to answer any questions.' : 'My resume and CV (PDF) are attached for your reference. If internships are not offered, I would appreciate a note on whom to contact instead.'
  const adLine = adMatch.length ? `The listing mentions ${adMatch.join(', ')}, which I have used in my coursework and projects.` : ''
  const body = ['Dear Hiring Team,', [opener, interest].filter(Boolean).join(' '), [project, adLine, toolLine].filter(Boolean).join(' '), availability, closer, `Kind regards,\n${sig}`].filter(Boolean).join('\n\n')
  return { subject: subject.replace(/\s+/g, ' ').trim(), body, usedFactIds: used, notes }
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
/** Words in the message itself (greeting, paragraphs, closing) — the signature block is excluded from the 110–180 target. */
export const bodyWords = (body: string) => wordCount(body.split(/\nKind regards,/)[0])

// ------------------------------------------------------------------ alignment (pre/post tailoring)
export const factIdsIn = (ast: ResumeAST) => new Set(ast.sections.flatMap((s) => [...(s.items ?? []).flatMap((i) => i.factIds), ...(s.skillGroups ?? []).flatMap((g) => g.factIds)]))

export interface Alignment {
  kind: 'ESTIMATE' | 'VACANCY'
  label: 'Company/role alignment estimate' | 'Vacancy fit (from the pasted job description)'
  pre: number | null; post: number | null; delta: number | null
  band: 'green' | 'amber' | 'grey'          // green only at >= 80 AND quality checks passed
  verdict: string
  confidence: 'High' | 'Medium' | 'Low'
  confidenceReasons: string[]
  reasons: string[]                         // met / partly met / missing / unknown, honest
  components: { label: string; value: number | null; note: string }[]
  changes: string[]                         // what tailoring actually changed (ordering / evidence coverage)
  disclaimer: string
}

const DISCLAIMER = 'An explainable estimate computed on this computer from your confirmed profile. It is not an ATS score, not a recruiter probability and not a promise of an interview.'

export function alignmentFor(i: {
  profile: Profile; facts: Fact[]; company: CompanyForFit; roleFamily: string; spec: JobSpec | null; jobText: string
  preAst: ResumeAST; postAst: ResumeAST; qualityOk: boolean; careerType: 'INTERNSHIP' | 'GRADUATE'; now: Date; staleDays: number | null
}): Alignment {
  const conf = confirmed(i.facts)
  const shown = (ast: ResumeAST) => { const ids = factIdsIn(ast); return conf.filter((f) => ids.has(f.fact_id)) }
  const hasAd = i.jobText.trim().length >= 40 && !!i.spec
  const run = (ast: ResumeAST): { score: number | null; fit: TargetFit | null; a: Assessment | null } => {
    const facts = shown(ast)
    const fit = targetFit({ profile: { roles: i.profile.roles, primary_role: i.profile.primary_role }, facts, company: i.company, focusRoles: [i.roleFamily], now: i.now })
    if (hasAd) { const a = assess({ profile: i.profile, facts, spec: i.spec!, jobText: i.jobText, company: i.company as any, careerType: i.careerType, now: i.now }); return { score: a.score ?? null, fit, a } }
    // No job description: a company-level estimate never claims more than 85.
    return { score: fit.score == null ? null : Math.min(fit.score, 85), fit, a: null }
  }
  const pre = run(i.preAst), post = run(i.postAst)
  const fit = post.fit!
  const confidenceReasons: string[] = []
  let conf3: Alignment['confidence'] = fit.confidence === 'HIGH' ? 'High' : fit.confidence === 'MEDIUM' ? 'Medium' : 'Low'
  if (!hasAd) { confidenceReasons.push('No job description supplied: this compares your profile with the employer\'s researched focus only.'); if (conf3 === 'High') conf3 = 'Medium' } else confidenceReasons.push('Scored against the job description you pasted.')
  if (i.staleDays == null || i.staleDays > 90) { confidenceReasons.push('Company information is older than 90 days or undated.'); if (conf3 !== 'Low') conf3 = conf3 === 'High' ? 'Medium' : 'Low' } else confidenceReasons.push(`Company information was checked ${i.staleDays} day(s) ago.`)
  const skills = conf.filter((f) => f.category === 'SKILL').length, work = conf.filter((f) => f.category === 'PROJECT' || f.category === 'EXPERIENCE').length
  confidenceReasons.push(`${skills} skill group(s) and ${work} project/experience entr${work === 1 ? 'y' : 'ies'} support this estimate.`)
  if (conf.some((f) => f.maturity === 'proposal')) confidenceReasons.push('A proposed (not yet completed) project is counted as partial evidence only.')

  const score = post.score
  const route = i.company.status_enum ?? 'NEEDS_VERIFICATION'
  const hasRoute = hasAd || route === 'VERIFIED_ACTIVE_VACANCY' || route === 'DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING'
  if (!hasRoute) confidenceReasons.push('No advertised or documented internship route: treated as a target priority for an enquiry, never as a strong match.')
  const green = score != null && score >= 80 && i.qualityOk && conf3 !== 'Low' && hasRoute
  const band: Alignment['band'] = score == null ? 'grey' : green ? 'green' : 'amber'
  const verdict = score == null ? 'Not enough confirmed profile information to estimate' : green ? 'Strong alignment, and the document checks passed' : score >= 80 ? 'High number, but not shown green: ' + (!i.qualityOk ? 'a document check needs attention' : !hasRoute ? 'no advertised or documented internship route' : 'confidence is low') : score >= 62 ? 'Reasonable alignment, with gaps shown below' : score >= 42 ? 'Partial alignment: worth a speculative enquiry, with gaps shown below' : 'Weak alignment for this role'

  // met / partly met / missing / unknown, straight from the computed evidence
  const reasons: string[] = []
  if (!(i.profile.roles as string[]).includes(i.roleFamily)) reasons.unshift(`Partly met: this role is outside the roles on your profile, so role alignment is counted as a stretch (half weight).`)
  for (const c of fit.components) reasons.push(`${c.value == null ? 'Unknown' : c.value >= 0.85 ? 'Met' : c.value >= 0.4 ? 'Partly met' : 'Missing'}: ${c.label}. ${c.note}`)
  if (post.a) for (const r of post.a.reasons ?? []) reasons.push(r)
  for (const g of fit.gaps.slice(0, 3)) reasons.push(`Missing: ${g}`)

  const preIds = factIdsIn(i.preAst), postIds = factIdsIn(i.postAst)
  const titleOf = (id: string) => conf.find((f) => f.fact_id === id)?.title ?? id
  const added = [...postIds].filter((x) => !preIds.has(x)), dropped = [...preIds].filter((x) => !postIds.has(x))
  const changes: string[] = []
  if (added.length) changes.push(`Now shown (more relevant to this role): ${added.map(titleOf).join('; ')}`)
  if (dropped.length) changes.push(`Moved to the CV only: ${dropped.map(titleOf).join('; ')}`)
  const firstSkill = (ast: ResumeAST) => ast.sections.find((s) => s.kind === 'skills')?.skillGroups?.[0]?.label
  if (firstSkill(i.preAst) !== firstSkill(i.postAst)) changes.push(`Skills section now leads with "${firstSkill(i.postAst)}"`)
  if (!changes.length) changes.push('No change in which evidence is shown: your most relevant work was already what the resume leads with. Tailoring only reorders; it cannot add skills you do not have.')

  return {
    kind: hasAd ? 'VACANCY' : 'ESTIMATE', label: hasAd ? 'Vacancy fit (from the pasted job description)' : 'Company/role alignment estimate',
    pre: pre.score, post: post.score, delta: pre.score != null && post.score != null ? post.score - pre.score : null,
    band, verdict, confidence: conf3, confidenceReasons, reasons: reasons.slice(0, 7),
    components: fit.components.map((c) => ({ label: c.label, value: c.value, note: c.note })), changes, disclaimer: DISCLAIMER,
  }
}

export const typicalTech = (family: string): string[] => (FAMILY_TECH as Record<string, string[] | undefined>)[family] ?? []
