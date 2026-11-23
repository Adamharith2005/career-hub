import { classifyRoleFamilies, findTech, roleLabel, type RoleFamily } from './domain.ts'
import { ADJACENT_ROLES } from './fit.ts'
import type { Fact, Profile } from './profiles.ts'

/**
 * COMPANY TARGET FIT — how relevant an employer's *researched* CS functions are to this person's chosen roles and confirmed profile.
 *
 * It is deliberately NOT: a vacancy score (see fit.ts, needs a real job ad), a prediction of acceptance, an ATS score, or a prestige rank.
 * The directory's `suitability_score` / `contact_score` are never read here (tested).
 *
 * Weights (sum = 1). A component with no usable evidence is `null` and is left out of the average (unknown ≠ zero);
 * the score is then reported with lower confidence instead of a harsh number.
 *   role      0.40  overlap between the company's researched role families and the person's target roles
 *   skills    0.25  confirmed skills vs. technologies typical for the matching role families (employer-named tech when present)
 *   projects  0.20  confirmed projects/experience that use tech or topics of the matching role families
 *   route     0.15  how reachable the employer is today (seed status A..D); NOT a hiring probability
 * The result is rounded to the nearest 5 (single-point precision would be false precision) and capped by confidence: HIGH 95, MEDIUM 90, LOW 75.
 */
export const TARGET_WEIGHTS = { role: 0.40, skills: 0.25, projects: 0.20, route: 0.15 } as const
export type TargetKey = keyof typeof TARGET_WEIGHTS
/** Ceiling per confidence level: a company-level estimate never displays 100, and thin evidence cannot display a very high number. */
export const SCORE_CEILING = { HIGH: 85, MEDIUM: 85, LOW: 75 } as const
/** Without a documented internship route (status C/D) a company is a speculative target: it never scores into the top two bands. */
export const NO_ROUTE_CEILING = 75

/** Technologies typical for each role family. A *hint about the field*, never a claim about what a specific employer requires. */
export const FAMILY_TECH: Record<Exclude<RoleFamily, 'other'>, string[]> = {
  swe: ['Java', 'Python', 'JavaScript', 'TypeScript', 'C#', '.NET', 'Git', 'SQL', 'REST APIs', 'Spring Boot', 'Docker', 'Node.js'],
  frontend: ['JavaScript', 'TypeScript', 'React', 'Vue', 'Angular', 'HTML', 'CSS', 'Figma', 'Tailwind CSS', 'Next.js'],
  backend: ['Java', 'Python', 'Node.js', 'SQL', 'REST APIs', 'Spring Boot', 'PostgreSQL', 'MySQL', 'Docker', 'Express', 'Django', 'FastAPI'],
  ai_ml: ['Python', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'Pandas', 'NumPy', 'Machine Learning', 'Deep Learning', 'NLP', 'LLM', 'OpenCV'],
  data: ['SQL', 'Python', 'Pandas', 'Power BI', 'Tableau', 'Excel', 'ETL', 'Spark', 'PostgreSQL', 'MySQL', 'Hadoop', 'Apache Hive', 'DAX', 'Matplotlib'],
  cyber: ['Linux', 'Wireshark', 'Nmap', 'Burp Suite', 'SIEM', 'Kali Linux', 'Penetration Testing', 'OWASP Top 10', 'Splunk', 'Python'],
  cloud_devops: ['Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'Linux', 'Terraform', 'CI/CD', 'Jenkins', 'GitHub Actions', 'Ansible', 'Bash'],
  qa: ['Selenium', 'Cypress', 'Playwright', 'Jest', 'Pytest', 'JUnit', 'Postman', 'JMeter', 'Agile'],
  it_support: ['Windows Server', 'Linux', 'Active Directory', 'TCP/IP', 'DNS', 'DHCP', 'VLAN', 'Cisco', 'VMware'],
}
const famTech = (f: string) => (FAMILY_TECH as Record<string, string[] | undefined>)[f] ?? []

export type FitLabel = 'Excellent target' | 'Strong target' | 'Possible target' | 'Low match'
export interface TargetComponent { key: TargetKey; label: string; weight: number; value: number | null; note: string }
export interface VacancyInfo { state: 'HISTORICAL_LISTING' | 'NOT_VERIFIED'; headline: string; detail: string }
export interface TargetFit {
  status: 'scored' | 'insufficient'
  score: number | null
  label: FitLabel | 'Not enough profile information'
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  roleAlignment: 'High' | 'Medium' | 'Low'
  components: TargetComponent[]
  reasons: string[]                       // 2–4 evidence-grounded sentences
  strengths: string[]; gaps: string[]     // gaps = common-in-field items you have not listed; NOT employer requirements
  missingProfile: string[]                // what would raise confidence
  matchedRoles: { role: string; label: string; why: string }[]
  warnings: string[]                      // documented hard requirements only
  vacancy: VacancyInfo
  resumeAngle: { skills: string[]; projects: { factId: string; title: string }[]; text: string }
  outreachAngle: string
  disclaimer: string
}

export interface CompanyForFit {
  company_id?: string; name: string
  role_families: string[]
  industry?: string | null; relevant_roles?: string | null; research_notes?: string | null; cs_relevance?: string | null
  status_enum?: string | null; last_verified?: string | null
  hr_email?: string | null; careers_page?: string | null; recommended_method?: string | null
}

const DISCLAIMER = 'Company target fit compares this employer’s researched focus with your chosen roles and confirmed profile. It is not a vacancy match, an ATS score or a prediction of any hiring decision.'

const ROUTE_VALUE: Record<string, number> = {
  VERIFIED_ACTIVE_VACANCY: 1, DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING: 0.7, PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK: 0.5, UNADVERTISED_SPECULATIVE_TARGET: 0.35,
}
const ROUTE_NOTE: Record<string, string> = {
  VERIFIED_ACTIVE_VACANCY: 'Seed research recorded an advertised listing (historical — confirm it is still open).',
  DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING: 'An internship programme is documented, but no active listing was recorded.',
  PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK: 'A careers portal exists; an intern track is unconfirmed.',
  UNADVERTISED_SPECULATIVE_TARGET: 'No advertised internship on record — a speculative enquiry is the realistic route.',
}

export const labelFor = (score: number, confidence: TargetFit['confidence']): FitLabel => {
  const raw: FitLabel = score >= 80 ? 'Excellent target' : score >= 62 ? 'Strong target' : score >= 42 ? 'Possible target' : 'Low match'
  // Limited evidence can never produce the two top labels.
  return confidence === 'LOW' && (raw === 'Excellent target' || raw === 'Strong target') ? 'Possible target' : raw
}

/** Technologies the person can honestly point to: confirmed skills and confirmed project/experience tech. */
export function profileTech(facts: Fact[]) {
  const confirmed = facts.filter((f) => f.confirmed)
  const skill = new Set<string>(), work = new Set<string>()
  for (const f of confirmed) {
    if (f.maturity === 'proposal') continue   // a proposed project is a topic of study, not demonstrated skill
    if (f.category === 'SKILL') for (const t of f.tools) for (const c of findTech(t)) skill.add(c)
    if (['PROJECT', 'EXPERIENCE'].includes(f.category)) for (const c of findTech([f.title, f.claim_text, f.tools.join(' ')].join('\n'))) work.add(c)
  }
  return { skill, work, all: new Set([...skill, ...work]) }
}

export function factFamilies(f: Fact): string[] {
  const text = [f.title, f.claim_text, f.tools.join(' '), f.details?.purpose ?? ''].join('\n')
  const techs = new Set(findTech(text))
  const fams = new Set<string>(classifyRoleFamilies(`${f.title} ${f.details?.purpose ?? ''} ${f.claim_text}`))
  // A family is inferred from technology only with two or more of its technologies: one shared tool (e.g. Linux) does not make a project "cloud" or "security".
  for (const fam of Object.keys(FAMILY_TECH)) if (famTech(fam).filter((t) => techs.has(t)).length >= 2) fams.add(fam)
  return [...fams]
}

const pickNote = (c: CompanyForFit) => [c.relevant_roles, c.industry, c.research_notes, c.cs_relevance].filter(Boolean).join(' ')

export interface FitInput { profile: Pick<Profile, 'roles' | 'primary_role'>; facts: Fact[]; company: CompanyForFit; focusRoles?: string[]; now?: Date }

export function targetFit(input: FitInput): TargetFit {
  const { profile, company } = input
  const facts = input.facts.filter((f) => f.confirmed)
  const roles = (input.focusRoles?.length ? input.focusRoles : profile.roles as string[]).filter((r) => r !== 'other')
  const primary = profile.primary_role && roles.includes(profile.primary_role) ? profile.primary_role : roles[0]
  const cFams = company.role_families.filter((f) => f !== 'other')
  const tech = profileTech(input.facts)
  const skillFacts = facts.filter((f) => f.category === 'SKILL')
  const workFacts = facts.filter((f) => f.category === 'PROJECT' || f.category === 'EXPERIENCE')
  const status = company.status_enum ?? 'NEEDS_VERIFICATION'

  const vacancy: VacancyInfo = status === 'VERIFIED_ACTIVE_VACANCY'
    ? { state: 'HISTORICAL_LISTING', headline: 'A listing was recorded in seed research',
        detail: `Research${company.last_verified ? ` (checked ${company.last_verified})` : ''} recorded an advertised role. This is historical — confirm it is still open on the company’s careers page before applying.` }
    : { state: 'NOT_VERIFIED', headline: 'No current opening verified; speculative inquiry may be possible',
        detail: 'This directory entry is not proof of an open internship. Check the careers page, then send a short, clearly-labelled enquiry if nothing is advertised.' }

  const missingProfile: string[] = []
  if (!roles.length) missingProfile.push('Choose at least one target role')
  if (!skillFacts.length) missingProfile.push('Add your skills')
  if (!workFacts.length) missingProfile.push('Add a project (or experience) that shows what you built')

  const warnings: string[] = []
  const note = pickNote(company)
  if (/malaysian citizens? only|citizens? only|bumiputera only/i.test(company.research_notes ?? '')) warnings.push('Research notes mention a citizenship requirement — confirm it with the employer.')

  const base = { vacancy, warnings, missingProfile, disclaimer: DISCLAIMER }
  const enough = roles.length > 0 && (skillFacts.length > 0 || workFacts.length > 0)
  if (!enough) {
    return { ...base, status: 'insufficient', score: null, label: 'Not enough profile information', confidence: 'LOW', roleAlignment: 'Low', components: [],
      reasons: [], strengths: [], gaps: [], matchedRoles: [], resumeAngle: { skills: [], projects: [], text: '' },
      outreachAngle: outreachFor(company, status) }
  }

  // ---- role. Primary target counts fully; other chosen targets 0.7; adjacent families 0.4. (Nearly every seed company lists "swe", so a
  //      secondary SWE target must not outrank someone whose PRIMARY target is the employer's specialty.)
  const WS = 0.7, WADJ = 0.4
  // A role you pick that is NOT among the roles on your profile is a stretch: it counts at half weight, so choosing a role never raises the score by itself.
  const owned = new Set((profile.roles as string[]) ?? [])
  const stretch = (r: string) => (input.focusRoles?.length && owned.size && !owned.has(r) ? 0.5 : 1)
  const roleScores = roles.map((r) => ({ r, v: stretch(r) * (cFams.includes(r) ? (r === primary ? 1 : WS) : cFams.some((f) => (ADJACENT_ROLES[r] ?? []).includes(f)) ? WADJ : 0) }))
  const roleV = cFams.length ? Math.max(0, ...roleScores.map((x) => x.v)) : null
  const matchedRoles = roleScores.filter((x) => x.v >= WADJ).sort((a, b) => b.v - a.v).map((x) => ({
    role: x.r, label: roleLabel(x.r), why: x.v >= WS ? `${company.name}’s researched roles include ${roleLabel(x.r)}.` : `Related to ${roleLabel(x.r)} through adjacent roles.`,
  }))
  const roleAlignment: TargetFit['roleAlignment'] = roleV == null ? 'Low' : roleV >= 1 ? 'High' : roleV >= WS ? 'Medium' : 'Low'

  // Evidence is measured against the families you TARGET that this employer also lists. If none overlap, against the employer's families at a discount.
  const targeted = cFams.filter((f) => roles.includes(f))
  const evidenceFams = targeted.length ? targeted : cFams
  const famWeight = (f: string) => (f === primary ? 1 : targeted.includes(f) ? 0.8 : 0.6)

  // ---- skills. Field-typical technologies for the matching families. Technology/topic words that the directory record happens to
  //      mention can only ADD evidence (max), never lower it: they are topics ("Digital Forensics", "IoT"), not requirements.
  const explicit = findTech(note)
  let skillsV: number | null = null, skillNote = 'No confirmed skills to compare yet.'
  let overlapTech: string[] = [], gapTech: string[] = [], bestFam = ''
  if (skillFacts.length || workFacts.length) {
    const per = evidenceFams.filter((f) => famTech(f).length).map((f) => {
      const hit = famTech(f).filter((t) => tech.all.has(t))
      return { f, hit, v: Math.min(1, hit.length / 3) * famWeight(f) }
    }).sort((a, b) => b.v - a.v)
    const named = explicit.filter((t) => tech.all.has(t))
    const namedV = explicit.length ? Math.min(1, named.length / Math.min(explicit.length, 4)) * 0.9 : null
    if (per.length) { bestFam = per[0].f; overlapTech = per[0].hit; gapTech = famTech(bestFam).filter((t) => !tech.all.has(t)).slice(0, 4) }
    overlapTech = [...new Set([...overlapTech, ...named])]
    const vals = [per[0]?.v, namedV].filter((v): v is number => v != null)
    if (vals.length) {
      skillsV = Math.max(...vals)
      skillNote = bestFam
        ? `You list ${overlapTech.length} technolog${overlapTech.length === 1 ? 'y' : 'ies'} typical for ${roleLabel(bestFam)} (typical for the field, not confirmed by this employer).`
        : `${named.length} of ${explicit.length} technologies named in the research record appear in your profile.`
    } else skillNote = 'The research record does not say which technologies matter here.'
  }

  // ---- projects
  let projV: number | null = null, projNote = 'No project or experience entries yet.'
  const relevant = workFacts.map((f) => {
    const fams = factFamilies(f)
    const direct = fams.filter((x) => evidenceFams.includes(x))
    const adj = fams.filter((x) => cFams.some((c) => (ADJACENT_ROLES[x] ?? []).includes(c)))
    const raw = direct.length ? Math.max(...direct.map(famWeight)) : adj.length ? 0.4 : 0
    const score = f.maturity === 'proposal' ? raw * 0.5 : raw   // proposal: partial evidence only
    return { f, direct, score }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  if (workFacts.length && cFams.length) {
    projV = relevant.length ? Math.min(1, relevant.reduce((s, x) => s + x.score, 0) / 2) : 0.15
    projNote = relevant.length ? `${relevant.length} of your ${workFacts.length} project/experience entr${workFacts.length === 1 ? 'y' : 'ies'} relate to this employer’s focus.` : 'None of your entries clearly relate to this employer’s focus yet — that is not a rejection, only less evidence.'
  }

  // ---- route
  const routeV = ROUTE_VALUE[status] ?? 0.3
  const components: TargetComponent[] = [
    { key: 'role', label: 'Role alignment', weight: TARGET_WEIGHTS.role, value: roleV, note: roleV == null ? 'The research record lists no role families for this employer.' : matchedRoles.length ? matchedRoles.map((m) => m.label).join(', ') : 'None of your target roles match the researched roles.' },
    { key: 'skills', label: 'Skills evidence', weight: TARGET_WEIGHTS.skills, value: skillsV, note: skillNote },
    { key: 'projects', label: 'Project evidence', weight: TARGET_WEIGHTS.projects, value: projV, note: projNote },
    { key: 'route', label: 'Opportunity route', weight: TARGET_WEIGHTS.route, value: routeV, note: ROUTE_NOTE[status] ?? 'Application route not verified.' },
  ]
  const known = components.filter((c) => c.value != null)
  const wsum = known.reduce((s, c) => s + c.weight, 0)
  const raw = wsum ? (100 * known.reduce((s, c) => s + c.weight * (c.value as number), 0)) / wsum : 0
  const rounded = Math.round(raw / 5) * 5

  // ---- confidence: more known components + real evidence = higher; field-typical skills cap at MEDIUM
  let confidence: TargetFit['confidence'] = 'MEDIUM'
  const allKnown = known.length === components.length
  if (!allKnown || skillFacts.length < 2 || !workFacts.length) confidence = 'LOW'
  else if (!explicit.some((t) => tech.all.has(t))) confidence = 'MEDIUM'
  else if (relevant.length >= 1 && skillFacts.length >= 3) confidence = 'HIGH'
  if (!workFacts.length) missingProfile.push('A project would make this fit more reliable')
  // Researched inputs are estimates, so no score may claim certainty: ceiling by evidence confidence.
  const documentedRoute = status === 'VERIFIED_ACTIVE_VACANCY' || status === 'DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING'
  const score = Math.min(rounded, SCORE_CEILING[confidence], documentedRoute ? 100 : NO_ROUTE_CEILING)

  // ---- narrative
  const reasons: string[] = []
  if (matchedRoles.length) reasons.push(matchedRoles[0].why)
  if (relevant.length) reasons.push(`Your project “${relevant[0].f.title}” relates to ${roleLabel(relevant[0].direct[0] ?? bestFam ?? 'swe')} work.`)
  if (overlapTech.length) reasons.push(`Your ${overlapTech.slice(0, 4).join(', ')} experience is relevant to ${bestFam ? roleLabel(bestFam) : 'this employer'}.`)
  reasons.push(vacancy.state === 'HISTORICAL_LISTING' ? 'A listing was recorded in research — verify it is still open.' : 'No current opening is verified; a speculative enquiry may be possible.')

  const strengths = [...overlapTech.slice(0, 5).map((t) => `${t}`), ...relevant.slice(0, 2).map((x) => x.f.title)]
  const angleSkills = [...tech.all].filter((t) => overlapTech.includes(t)).slice(0, 6)
  const resumeAngle = {
    skills: angleSkills,
    projects: relevant.slice(0, 2).map((x) => ({ factId: x.f.fact_id, title: x.f.title })),
    text: relevant.length || angleSkills.length
      ? `Lead with ${[relevant[0] && `“${relevant[0].f.title}”`, angleSkills.length && angleSkills.slice(0, 3).join(', ')].filter(Boolean).join(' and ')}.`
      : 'Add a project or skills that relate to this employer to give your resume a clear angle.',
  }

  return {
    ...base, status: 'scored', score, label: labelFor(score, confidence), confidence, roleAlignment, components, reasons: reasons.slice(0, 4),
    strengths, gaps: gapTech.map((t) => `${t} (common in this field — not a stated requirement)`), matchedRoles, resumeAngle, outreachAngle: outreachFor(company, status),
  }
}

export function outreachFor(c: CompanyForFit, status: string): string {
  const portal = c.careers_page ? 'the careers page' : 'the company website'
  if (status === 'VERIFIED_ACTIVE_VACANCY') return `Check ${portal} for the listed role first and apply there; use email only to add a short note if you have a verified address.`
  if (status === 'DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING') return `Look at ${portal}, then send a short speculative enquiry that names the internship programme and your available dates.`
  if (status === 'PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK') return `Check ${portal} for any intern track; if none, a brief speculative enquiry is reasonable.`
  return 'Nothing is advertised: a short, clearly-labelled speculative enquiry is the only realistic route. Do not imply an opening exists.'
}

/** Role-family context for a company, used by tailoring: which families to foreground for a chosen role, and which technologies are typical. */
export function companyContext(c: CompanyForFit, roleFamily?: string) {
  const fams = c.role_families.filter((f) => f !== 'other')
  const focus = roleFamily && fams.includes(roleFamily) ? roleFamily : (roleFamily && roleFamily !== 'other' ? roleFamily : fams[0] ?? 'swe')
  const explicit = findTech(pickNote(c))
  const typical = [...new Set([...explicit, ...famTech(focus)])]
  return { families: fams, focus, explicitTech: explicit, wantedTech: typical, industry: c.industry ?? null }
}
