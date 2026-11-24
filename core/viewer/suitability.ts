/**
 * Transparent company/role alignment estimate. Pure functions, no I/O.
 * It uses only the student's own recorded facts and the research evidence for the organisation.
 * It is NOT a vacancy match and NOT a hiring probability. Unknown requirements stay unknown.
 */
import type { CatalogCompany, TechTag } from './catalog.ts'

export type RoleFamily = 'DATA_ANALYTICS' | 'DATA_SCIENCE_ML' | 'DATA_ENGINEERING' | 'AI_INTEGRATION' | 'SOFTWARE' | 'FULL_STACK' | 'CYBERSECURITY' | 'CLOUD_DEVOPS' | 'INFO_SYSTEMS'
export const ROLE_LABEL: Record<RoleFamily, string> = {
  DATA_ANALYTICS: 'Data analytics / BI', DATA_SCIENCE_ML: 'Data science / ML', DATA_ENGINEERING: 'Data engineering', AI_INTEGRATION: 'AI integration', SOFTWARE: 'Software engineering',
  FULL_STACK: 'Full-stack development', CYBERSECURITY: 'Cybersecurity', CLOUD_DEVOPS: 'Cloud / DevOps', INFO_SYSTEMS: 'Information systems',
}

interface Concept { key: string; label: string; re: RegExp; related?: string[] }
const C: Concept[] = [
  { key: 'python', label: 'Python', re: /\bpython\b/i },
  { key: 'pandas', label: 'pandas / NumPy', re: /\bpandas\b|\bnumpy\b/i, related: ['python'] },
  { key: 'sklearn', label: 'scikit-learn', re: /scikit|sklearn/i, related: ['ml'] },
  { key: 'ml', label: 'Machine learning', re: /machine learning|\bml\b|predict|classif|regress|forecast/i },
  { key: 'stats', label: 'Statistical analysis', re: /statistic|spss|hypothesis|regression/i },
  { key: 'sql', label: 'SQL', re: /\bsql\b|hiveql|postgres|mysql|sqlite/i },
  { key: 'bigdata', label: 'Hive / Hadoop', re: /\bhive\b|hadoop|spark|big data/i, related: ['sql'] },
  { key: 'bi', label: 'Power BI / BI tools', re: /power ?bi|\bdax\b|tableau|looker|business intelligence/i, related: ['excel', 'dataviz'] },
  { key: 'excel', label: 'Excel / Sheets', re: /excel|google sheets|spreadsheet/i },
  { key: 'dataviz', label: 'Data visualisation', re: /visuali[sz]|dashboard|matplotlib|seaborn|plotly/i, related: ['bi'] },
  { key: 'etl', label: 'ETL / data pipelines', re: /\betl\b|pipeline|data clean|data process|data warehouse/i, related: ['sql', 'bigdata'] },
  { key: 'js', label: 'TypeScript / JavaScript', re: /typescript|javascript|\bjs\b|\bts\b/i },
  { key: 'react', label: 'React', re: /\breact\b|next\.?js|vue|angular/i, related: ['js'] },
  { key: 'css', label: 'HTML / CSS / Tailwind', re: /tailwind|\bcss\b|\bhtml\b/i },
  { key: 'backend', label: 'Backend / APIs', re: /\bnode(\.?js)?\b|\bexpress\b|\bapi\b|\brest(ful)?\b|cloudflare workers|backend|back-end/i, related: ['js'] },
  { key: 'firebase', label: 'Firebase / Firestore', re: /firebase|firestore|supabase|mongodb|nosql/i, related: ['sql'] },
  { key: 'dbdesign', label: 'Database design', re: /normali[sz]ation|database design|erd|relational/i, related: ['sql'] },
  { key: 'mobile', label: 'Mobile (Android)', re: /android|kotlin|flutter|swift/i },
  { key: 'java', label: 'Java / C-family', re: /\bjava\b|c\+\+|c#|\bgo\b|golang|rust/i },
  { key: 'git', label: 'Git / GitHub', re: /\bgit\b|github/i },
  { key: 'cloud', label: 'Cloud (AWS / Azure / GCP)', re: /\baws\b|azure|\bgcp\b|google cloud|cloud/i },
  { key: 'iac', label: 'Terraform / IaC', re: /terraform|infrastructure as code|cloudformation|ansible/i, related: ['cloud'] },
  { key: 'devops', label: 'Docker / CI-CD', re: /docker|kubernetes|ci\/cd|github actions|devops/i },
  { key: 'security', label: 'Security', re: /security|\biam\b|cyber|attack|vulnerab|misconfiguration|remediation/i },
  { key: 'network', label: 'Networking', re: /network|tcp|dns|firewall/i },
  { key: 'llm', label: 'Gemini / LLM integration', re: /gemini|\bllm\b|openai|prompt engineering|generative|gen-?ai|workers ai/i, related: ['ml'] },
  { key: 'analysis', label: 'Business / systems analysis', re: /information system|business analy|systems analy|requirement|inventory|workflow|erp|digital transformation/i },
  { key: 'webapp', label: 'Web applications', re: /web app|react|website|web-based|firebase|platform/i, related: ['js'] },
]
const byKey = new Map(C.map((c) => [c.key, c]))
/** Concept keys whose pattern appears in a text. Used by CV evidence checks. */
export const conceptsIn = (text: string): string[] => C.filter((c) => c.re.test(text)).map((c) => c.key)
export const conceptLabel = (k: string) => byKey.get(k)?.label ?? k
export const roleNeeds = (r: RoleFamily) => ROLE_NEEDS[r]

/** Typical requirements of a role family. These are NOT claims about a specific employer. */
const ROLE_NEEDS: Record<RoleFamily, [string, number][]> = {
  DATA_ANALYTICS: [['sql', 3], ['python', 3], ['bi', 3], ['dataviz', 2], ['stats', 2], ['excel', 1], ['pandas', 2]],
  DATA_SCIENCE_ML: [['python', 3], ['ml', 3], ['pandas', 3], ['sklearn', 2], ['stats', 2], ['sql', 2], ['dataviz', 1]],
  DATA_ENGINEERING: [['sql', 3], ['python', 3], ['bigdata', 3], ['etl', 3], ['cloud', 1]],
  AI_INTEGRATION: [['llm', 3], ['python', 2], ['js', 2], ['backend', 2], ['ml', 2], ['cloud', 1]],
  SOFTWARE: [['js', 2], ['java', 1], ['python', 1], ['backend', 2], ['sql', 2], ['git', 2], ['webapp', 2]],
  FULL_STACK: [['js', 3], ['react', 3], ['backend', 2], ['firebase', 2], ['sql', 2], ['css', 2], ['git', 1]],
  CYBERSECURITY: [['security', 3], ['network', 2], ['cloud', 2], ['python', 2], ['iac', 1]],
  CLOUD_DEVOPS: [['cloud', 3], ['iac', 2], ['devops', 3], ['network', 1], ['security', 1], ['python', 1]],
  INFO_SYSTEMS: [['sql', 3], ['dbdesign', 2], ['analysis', 3], ['webapp', 2], ['excel', 1], ['cloud', 1]],
}
const TAG_TO_ROLE: Partial<Record<TechTag, RoleFamily[]>> = {
  SOFTWARE: ['SOFTWARE'], FULL_STACK: ['FULL_STACK', 'SOFTWARE'], AI_ML: ['DATA_SCIENCE_ML', 'AI_INTEGRATION'], DATA_SCIENCE: ['DATA_SCIENCE_ML'], ANALYTICS: ['DATA_ANALYTICS'],
  DATA_ENGINEERING: ['DATA_ENGINEERING'], CYBERSECURITY: ['CYBERSECURITY'], CLOUD: ['CLOUD_DEVOPS'], DEVOPS: ['CLOUD_DEVOPS'], INFO_SYSTEMS: ['INFO_SYSTEMS'], NETWORKING: ['CYBERSECURITY'], IT_INFRA: ['CLOUD_DEVOPS', 'INFO_SYSTEMS'], SYSADMIN: ['INFO_SYSTEMS'],
}
const ADJACENT: Record<RoleFamily, RoleFamily[]> = {
  DATA_ANALYTICS: ['DATA_SCIENCE_ML', 'DATA_ENGINEERING', 'INFO_SYSTEMS'], DATA_SCIENCE_ML: ['DATA_ANALYTICS', 'AI_INTEGRATION', 'DATA_ENGINEERING'], DATA_ENGINEERING: ['DATA_ANALYTICS', 'DATA_SCIENCE_ML', 'CLOUD_DEVOPS'],
  AI_INTEGRATION: ['DATA_SCIENCE_ML', 'SOFTWARE', 'FULL_STACK'], SOFTWARE: ['FULL_STACK', 'AI_INTEGRATION', 'CLOUD_DEVOPS'], FULL_STACK: ['SOFTWARE', 'INFO_SYSTEMS', 'AI_INTEGRATION'],
  CYBERSECURITY: ['CLOUD_DEVOPS', 'INFO_SYSTEMS'], CLOUD_DEVOPS: ['CYBERSECURITY', 'SOFTWARE', 'DATA_ENGINEERING'], INFO_SYSTEMS: ['FULL_STACK', 'DATA_ANALYTICS', 'CLOUD_DEVOPS'],
}
const SPEC_HOME: Record<string, RoleFamily[]> = {
  data: ['DATA_ANALYTICS', 'DATA_SCIENCE_ML', 'DATA_ENGINEERING', 'AI_INTEGRATION'],
  info: ['INFO_SYSTEMS', 'FULL_STACK', 'SOFTWARE', 'CLOUD_DEVOPS', 'CYBERSECURITY', 'AI_INTEGRATION'],
}

/** How much a project counts as evidence. Proposals and uncertain team contributions count for less; nothing counts for more than 1. */
export const projectWeight = (p: { status: string; contribution?: string }): number => {
  const base = ({ COMPLETED: 1, LIVE: 1, PROTOTYPE: 0.85, IN_PROGRESS: 0.7, PROPOSED: 0.6, CONCEPT: 0.5 } as Record<string, number>)[p.status] ?? 0.7
  return p.contribution === 'TEAM_UNCERTAIN' ? base * 0.5 : base
}
export interface StudentFacts {
  id: string; specialisation: string; degree: string
  education: { title: string; points: string[] }[]
  skills: { group: string; items: string[] }[]
  projects: { title: string; status: string; stack: string[]; points: string[]; contribution?: string }[]
  interests: string[]
  leadership?: { title: string; organisation: string; themes?: string[] }[]
}
export type Tier = 'EXCELLENT' | 'STRONG' | 'MODERATE' | 'LIMITED'
export const tierOf = (n: number): Tier => n >= 85 ? 'EXCELLENT' : n >= 70 ? 'STRONG' : n >= 50 ? 'MODERATE' : 'LIMITED'
export const TIER_LABEL: Record<Tier, string> = { EXCELLENT: 'Excellent alignment', STRONG: 'Strong alignment', MODERATE: 'Moderate alignment', LIMITED: 'Limited alignment' }

export interface Dimension { key: string; label: string; weight: number; value: number; points: number; known: boolean; why: string }
export interface SkillRow { key: string; label: string; credit: number; source: string | null }
export interface Suitability {
  score: number; tier: Tier; provisional: boolean; confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  role: RoleFamily; roleLabel: string; basis: 'company-role estimate'
  dimensions: Dimension[]
  skills: { matched: SkillRow[]; partial: SkillRow[]; missing: SkillRow[] }
  projects: { title: string; relevance: number; status: string; hits: string[] }[]
  unverified: string[]; notes: string[]
}

/** What the student can show per concept: declared skill = 1, completed project = 1, proposed/unknown project = 0.6, interest = 0.25, related concept = 0.5×. */
export function studentCredit(s: StudentFacts): Map<string, { credit: number; source: string }> {
  const out = new Map<string, { credit: number; source: string }>()
  const put = (k: string, credit: number, source: string) => { const c = out.get(k); if (!c || credit > c.credit) out.set(k, { credit, source }) }
  for (const g of s.skills) for (const item of g.items) for (const c of C) if (c.re.test(item)) put(c.key, 1, `Skill: ${item}`)
  for (const p of s.projects) {
    const f = projectWeight(p)
    // Only the stack and the title are counted; free-text bullets are too loose to prove a skill.
    const text = [p.title, ...p.stack].join(' ')
    for (const c of C) if (c.re.test(text)) put(c.key, f, `Project: ${p.title}`)
  }
  for (const i of s.interests) for (const c of C) if (c.re.test(i)) put(c.key, 0.25, `Interest: ${i}`)
  for (const c of C) if (!out.has(c.key) && c.related) { const best = Math.max(0, ...c.related.map((r) => out.get(r)?.credit ?? 0)); if (best > 0) put(c.key, best * 0.5, `Related to ${c.related.join(' / ')}`) }
  return out
}

export const cgpaOf = (s: StudentFacts): number | null => {
  for (const e of s.education) if (/computer science|bachelor/i.test(e.title)) for (const p of e.points) { const m = /cgpa[^0-9]*([0-4]\.\d{1,2})/i.exec(p); if (m) return Number(m[1]) }
  return null
}

export function companyRoles(c: CatalogCompany): RoleFamily[] {
  const set = new Set<RoleFamily>()
  for (const t of c.tech) for (const r of TAG_TO_ROLE[t] ?? []) set.add(r)
  return [...set]
}
/** The role the company most plausibly offers for this student (used when no role is chosen). */
export function defaultRole(s: StudentFacts, c: CatalogCompany): RoleFamily {
  const home = SPEC_HOME[/data/i.test(s.specialisation) ? 'data' : 'info']
  const offered = companyRoles(c)
  const credit = studentCredit(s)
  const cover = (r: RoleFamily) => { const n = ROLE_NEEDS[r]; return n.reduce((a, [k, w]) => a + w * (credit.get(k)?.credit ?? 0), 0) / n.reduce((a, [, w]) => a + w, 0) }
  const pool = offered.length ? offered : home
  return [...pool].sort((a, b) => cover(b) + (home.includes(b) ? 0.1 : 0) - (cover(a) + (home.includes(a) ? 0.1 : 0)))[0]
}

const EVID: Record<string, number> = { ACTIVE_OPENING: 1, CONFIRMED_PROGRAMME: 1, REPORTED_PROGRAMME: 0.7, HISTORICAL: 0.5, DIRECT_OUTREACH: 0.3, UNKNOWN: 0.2, NOT_ACCEPTING: 0 }
const r1 = (n: number) => Math.round(n * 10) / 10

export function suitability(s: StudentFacts, c: CatalogCompany, role?: RoleFamily): Suitability {
  const family = role ?? defaultRole(s, c)
  const credit = studentCredit(s)
  const needs = ROLE_NEEDS[family]
  const tot = needs.reduce((a, [, w]) => a + w, 0)
  const rows: SkillRow[] = needs.map(([k, w]) => { const cr = credit.get(k); return { key: k, label: byKey.get(k)!.label, credit: cr?.credit ?? 0, source: cr?.source ?? null, ...{ w } } as SkillRow })
  // Capped: the needs list is typical for the role, not this employer's own requirement list, so full marks are never given.
  const skillVal = 0.92 * needs.reduce((a, [k, w]) => a + w * (credit.get(k)?.credit ?? 0), 0) / tot
  const matched = rows.filter((r) => r.credit >= 0.95), partial = rows.filter((r) => r.credit > 0 && r.credit < 0.95), missing = rows.filter((r) => r.credit === 0)

  // Projects: relevance = share of the role's weighted needs a project's stack/title shows.
  const projects = s.projects.map((p) => {
    const text = [p.title, ...p.stack].join(' ')
    const hitKeys = needs.filter(([k]) => byKey.get(k)!.re.test(text))
    const rel = hitKeys.reduce((a, [, w]) => a + w, 0) / tot
    const f = projectWeight(p)
    return { title: p.title, relevance: Math.min(0.95, rel * 1.5) * f, status: p.status, hits: hitKeys.map(([k]) => byKey.get(k)!.label) }
  }).sort((a, b) => b.relevance - a.relevance)
  const projVal = Math.min(0.95, (projects[0]?.relevance ?? 0) + 0.3 * (projects[1]?.relevance ?? 0))

  // Organisation function fit.
  const offered = companyRoles(c)
  const knownFn = offered.length > 0
  // An organisation listing many kinds of work says less about this one role, so breadth lowers the certainty.
  const breadth = Math.min(0.3, Math.max(0, offered.length - 2) * 0.08)
  const fnVal = !knownFn ? 0.4 : offered.includes(family) ? 1 - breadth : offered.some((o) => ADJACENT[family].includes(o) || ADJACENT[o].includes(family)) ? 0.5 : 0.1
  const roleText = (c.roles.join(' ') + ' ' + (c.relevance ?? '')).toLowerCase()
  const fnBoost = knownFn && fnVal === 1 && ROLE_LABEL[family].toLowerCase().split(/[ /]+/).some((w) => w.length > 4 && roleText.includes(w)) ? 0 : 0

  // Academic: specialisation fits the role + CGPA on record.
  const home = SPEC_HOME[/data/i.test(s.specialisation) ? 'data' : 'info']
  const specVal = home.includes(family) ? 0.9 : 0.55
  const gpa = cgpaOf(s)
  const gpaVal = gpa == null ? 0.5 : gpa >= 3.0 ? Math.min(1, 0.55 + (gpa - 3.0) * 0.6) : gpa >= 2.75 ? 0.45 : 0.25
  const acadVal = 0.6 * specVal + 0.4 * gpaVal

  const evVal = EVID[c.internship.evidence] ?? 0.2
  const confVal = (c.verificationLevel === 'VERIFIED' ? 0.4 : c.verificationLevel === 'PROBABLE' ? 0.25 : 0.1) + (c.lastVerified ? 0.3 : 0) + (c.internship.evidence !== 'UNKNOWN' ? 0.3 : 0.1)

  const D = (key: string, label: string, weight: number, value: number, known: boolean, why: string): Dimension => ({ key, label, weight, value, points: r1(weight * value), known, why })
  const dimensions: Dimension[] = [
    D('skills', 'Relevant technical skills', 30, skillVal, true, `${matched.length} of ${needs.length} typical ${ROLE_LABEL[family]} skills shown in full, ${partial.length} partly.`),
    D('projects', 'Projects and practical experience', 25, projVal, true, projects[0] && projects[0].relevance > 0 ? `Best match: ${projects[0].title}.` : 'No recorded project shows this role\'s typical tools.'),
    D('function', "Fit with the organisation's technical work", 20, fnVal + fnBoost, knownFn, knownFn ? (offered.includes(family) ? `The organisation's research lists ${ROLE_LABEL[family]} work.` : 'Only adjacent technical work is listed.') : 'The research does not say what technical work this organisation does. Scored neutral.'),
    D('academic', 'Academic and eligibility alignment', 10, acadVal, gpa != null, `${s.specialisation}${gpa != null ? `, CGPA ${gpa.toFixed(2)}` : ', CGPA not recorded'}.`),
    D('internship', 'Internship opportunity relevance', 10, evVal, c.internship.evidence !== 'UNKNOWN', 'Based on the internship evidence on file. Not a statement that a vacancy exists.'),
    D('confidence', 'Evidence confidence', 5, Math.min(1, confVal), true, 'Office verification, date checked and internship evidence.'),
  ]
  const score = Math.round(dimensions.reduce((a, d) => a + d.points, 0))
  const unknownCount = dimensions.filter((d) => !d.known).length
  const provisional = !knownFn || confVal < 0.5 || unknownCount >= 2
  const confidence: Suitability['confidence'] = provisional ? 'LOW' : confVal >= 0.8 && unknownCount === 0 ? 'HIGH' : 'MEDIUM'
  const unverified = ['No job description is available, so skill requirements are typical for the role family, not this employer\'s own list.', ...c.uncertainties.slice(0, 3)]
  const notes = ['Company/role alignment estimate. It is not a vacancy match or a hiring probability.', 'Allowance does not affect this score.']
  return { score, tier: tierOf(score), provisional, confidence, role: family, roleLabel: ROLE_LABEL[family], basis: 'company-role estimate', dimensions, skills: { matched, partial, missing }, projects: projects.slice(0, 3), unverified, notes }
}

export type SortKey = 'match' | 'allowance' | 'technical' | 'verified' | 'contact' | 'confidence' | 'name'
export function contactEase(c: CatalogCompany): number {
  const k = c.contacts; return (k.hrEmail ? 3 : 0) + (k.generalEmail ? 2 : 0) + (k.careersUrl ? 1 : 0) + (k.contactForm ? 1 : 0) + (k.phone ? 0.5 : 0)
}
export const EVIDENCE_ORDER = ['ACTIVE_OPENING', 'CONFIRMED_PROGRAMME', 'REPORTED_PROGRAMME', 'HISTORICAL', 'DIRECT_OUTREACH', 'UNKNOWN', 'NOT_ACCEPTING']
