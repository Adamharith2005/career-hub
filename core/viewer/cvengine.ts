/**
 * Deterministic, offline CV engine. Pure functions, no I/O, no network.
 * Every line of a generated CV is copied or assembled from facts already recorded in the student's own profile.
 * Tailoring changes order, emphasis and wording of the summary only. It never adds a skill, project, number or claim.
 */
import type { ResumeAST, ResumeItem, ResumeSection, Bullet, ChangeLogEntry, SkillGroup } from '../resume.ts'
import { conceptsIn, conceptLabel, roleNeeds, studentCredit, cgpaOf, projectWeight, ROLE_LABEL, type RoleFamily, type StudentFacts } from './suitability.ts'
import type { Profile } from './store.ts'

export const CV_SCHEMA = 1
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
let n = 0
const id = (p: string) => `${p}${++n}`
const bullet = (text: string, src: string): Bullet => ({ id: id('b'), text, original: text, sourceFactIds: [src] })
const STATUS_TAG: Record<string, string> = { PROPOSED: 'Proposed, in progress', IN_PROGRESS: 'In progress', PROTOTYPE: 'Prototype', CONCEPT: 'Concept', COMPLETED: '', LIVE: '', UNKNOWN: '' }
const degreeShort = (p: Profile) => p.degree.replace(/^Bachelor of /i, 'B.').replace(/\s+/g, ' ') || 'Computer Science'

export interface CvTarget { company: string; role: RoleFamily | null; vacancy: 'NONE' | 'GIVEN'; notes?: string }
export interface CvChange { kind: 'added' | 'removed' | 'moved' | 'reworded' | 'emphasised'; where: string; text: string; why: string }
export interface CvBuild { ast: ResumeAST; changes: CvChange[]; flags: string[]; label: string }

/* ---- relevance ---- */
function needsOf(role: RoleFamily | null) { return role ? roleNeeds(role) : [] }
function textRelevance(text: string, role: RoleFamily | null): number {
  const ks = new Set(conceptsIn(text)); const needs = needsOf(role)
  if (!needs.length) return 0
  return needs.reduce((a, [k, w]) => a + (ks.has(k) ? w : 0), 0) / needs.reduce((a, [, w]) => a + w, 0)
}

/* ---- sections from the profile ---- */
function educationSection(p: Profile): ResumeSection {
  const tidy = (x: string) => x.replace(/\s*\(user-corrected\)/i, '').replace(/^Current\s+/i, '').replace(/CGPA:\s*/i, 'CGPA ')
  return { id: id('sec'), title: 'Education', kind: 'education', items: p.education.map((e) => ({ id: id('i'), heading: e.title, subheading: [e.institution, ...e.points.map(tidy)].filter(Boolean).join(' · '), dates: e.dates || undefined, factIds: [], bullets: [] })) }
}
function skillsSection(p: Profile, role: RoleFamily | null, tailored: boolean, log: ChangeLogEntry[]): ResumeSection {
  const needKeys = new Set(needsOf(role).map(([k]) => k))
  const scored = p.skills.map((g, i) => {
    const items = [...g.items].sort((a, b) => Number(conceptsIn(b).some((k) => needKeys.has(k))) - Number(conceptsIn(a).some((k) => needKeys.has(k))))
    const rel = g.items.filter((it) => conceptsIn(it).some((k) => needKeys.has(k))).length
    return { g, items, rel, i }
  })
  let groups = scored
  if (tailored && role) {
    groups = [...scored].sort((a, b) => b.rel - a.rel || a.i - b.i)
    if (groups.length > 3) { const kept = groups.filter((x) => x.rel > 0); for (const x of groups) if (!kept.includes(x) && kept.length >= 2) log.push({ kind: 'omitted', section: 'Skills', reason: `"${x.g.group}" has nothing the ${ROLE_LABEL[role]} role typically asks for.` }); if (kept.length >= 2) groups = kept }
    if (groups[0]?.i !== 0) log.push({ kind: 'ordered', section: 'Skills', reason: `"${groups[0].g.group}" moved first because it matches ${ROLE_LABEL[role]}.` })
  } else groups = scored
  const skillGroups: SkillGroup[] = groups.map((x) => ({ label: x.g.group, values: tailored && role ? x.items : x.g.items, factIds: [`skills:${x.g.group}`] }))
  return { id: id('sec'), title: 'Skills', kind: 'skills', skillGroups }
}
function projectItem(pr: Profile['projects'][number], role: RoleFamily | null, maxBullets = 99): ResumeItem {
  const tag = STATUS_TAG[pr.status] ?? ''
  const inv = pr.bullets?.length
  let texts: string[]
  if (inv) {
    // Inventory bullets: choose the ones that show the most of what the role asks for, keep their original order.
    const scored = pr.bullets!.map((b, i) => ({ b, i, r: textRelevance(b.text, role) + (b.themes?.some((t) => role && t === role) ? 0.3 : 0) }))
    const pick = maxBullets >= scored.length ? scored : [...scored].sort((a, b) => b.r - a.r || a.i - b.i).slice(0, maxBullets).sort((a, b) => a.i - b.i)
    texts = pick.map((x) => x.b.text)
  } else texts = pr.points.map((x) => (pr.status === 'PROPOSED' && !/^proposed|^proposal/i.test(x) ? `Proposed: ${x[0].toLowerCase()}${x.slice(1)}` : x))
  const bullets = texts.map((t) => bullet(t, `project:${pr.id ?? pr.title}`))
  if (pr.stack.length) bullets.push(bullet(`Technologies: ${pr.stack.join(', ')}`, `project:${pr.id ?? pr.title}`))
  return { id: id('i'), heading: pr.title, subheading: [tag, pr.context].filter(Boolean).join(' | ') || undefined, dates: pr.date || undefined, factIds: [], bullets }
}
function awardsSection(p: Profile): ResumeSection | null {
  if (!p.awards?.length) return null
  return { id: id('sec'), title: 'Awards & Competitions', kind: 'awards', items: p.awards.map((a) => ({ id: id('i'), heading: a.title, dates: a.date || undefined, subheading: undefined, factIds: [], bullets: a.detail ? [bullet(a.detail, `award:${a.title}`)] : [] })) }
}
function leadershipSection(p: Profile, role: RoleFamily | null, tailored: boolean, log: ChangeLogEntry[]): ResumeSection | null {
  if (!p.leadership.length) return null
  const sorted = [...p.leadership].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  let chosen = sorted
  if (tailored) {
    const wantsSponsor = role === 'INFO_SYSTEMS' || role === 'FULL_STACK' || role === 'SOFTWARE'
    chosen = [...sorted].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || Number(wantsSponsor && b.themes?.includes('sponsorship')) - Number(wantsSponsor && a.themes?.includes('sponsorship'))).slice(0, 4)
    for (const x of sorted) if (!chosen.includes(x)) log.push({ kind: 'omitted', section: 'Leadership', reason: `${x.title}, ${x.organisation} (${x.date}) left out to keep the CV focused. Four most recent roles kept.` })
  }
  return { id: id('sec'), title: 'Leadership & College Involvement', kind: 'leadership', items: chosen.map((e) => ({ id: id('i'), heading: `${e.title}, ${e.organisation}`, dates: e.date || undefined, factIds: [], bullets: e.points.map((x) => bullet(x, `leadership:${e.id ?? e.organisation}`)) })) }
}
function experienceSection(p: Profile): ResumeSection | null {
  if (!p.experience.length) return null
  return { id: id('sec'), title: 'Work Experience', kind: 'experience', items: p.experience.map((e) => ({ id: id('i'), heading: `${e.title}, ${e.organisation}`, dates: e.date || undefined, factIds: [], bullets: e.points.map((x) => bullet(x, `experience:${e.organisation}`)) })) }
}

/* ---- summary ---- */
export function summaryFor(p: Profile, role: RoleFamily | null, company: string | null): string {
  const s = studentCredit(p as unknown as StudentFacts)
  const needs = needsOf(role)
  const short = (t: string) => t.split(' — ')[0].replace(/ with AI-Assisted Remediation/i, '')
  // Use the student's own words for skills ("Terraform and AWS"), never the taxonomy label.
  const declared = [...new Set(needs.filter(([k]) => (s.get(k)?.credit ?? 0) >= 1 && s.get(k)!.source.startsWith('Skill:')).map(([k]) => s.get(k)!.source.replace(/^Skill:\s*/, '').replace(/\s*\(.*?\)\s*$/, '').split(/, | and /)[0]))]
  const inProgress = (x: { status: string }) => ['PROPOSED', 'IN_PROGRESS', 'CONCEPT'].includes(x.status)
  const done = p.projects.filter((x) => !inProgress(x) && x.contribution !== 'TEAM_UNCERTAIN').map((x) => ({ x, r: textRelevance([x.title, ...x.stack].join(' '), role) })).sort((a, b) => b.r - a.r)
  const proposed = p.projects.find(inProgress)
  const gpa = cgpaOf(p as unknown as StudentFacts)
  const spec = /data/i.test(p.specialisation) ? 'Data Science' : 'Information Systems'
  const head = `Computer Science (${spec}) student at ${p.university}${gpa ? ` with a CGPA of ${gpa.toFixed(2)}` : ''}`
  const target = role ? ` seeking ${withArticle(lcFirst(ROLE_LABEL[role]))} internship${company ? ` at ${company}` : ''}` : ' seeking an industrial training placement'
  const evid: string[] = []
  if (role && declared.length) evid.push(`Works with ${list(declared.slice(0, 4))}`)
  const top = done.filter((d) => d.r > 0).slice(0, 2)
  if (top.length) evid.push(`applied in ${list(top.map((d) => short(d.x.title)))}`)
  else if (!role && done.length) evid.push(`Projects include ${list(done.slice(0, 2).map((d) => short(d.x.title)))}`)
  if (role && proposed && textRelevance([proposed.title, ...proposed.stack].join(' '), role) > 0.15 && (!proposed.themes?.length || proposed.themes.includes(role))) evid.push(`final year project in progress: ${short(proposed.title)}`)
  const aw = p.awards?.[0]
  return `${head}${target}.${evid.length ? ` ${cap(evid.join('; '))}.` : ''}${aw ? ` ${aw.title}.` : ''}`
}
const lcFirst = (x: string) => (/^[A-Z][a-z]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x)
const withArticle = (x: string) => `${/^(AI\b|[aeiou])/i.test(x) && !/^(u[^n]|eu)/i.test(x) ? 'an' : 'a'} ${x}`
const list = (a: string[]) => a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function header(p: Profile, headline?: string): ResumeAST['header'] {
  const contacts: ResumeAST['header']['contacts'] = []
  if (p.contact.email) contacts.push({ label: 'Email', text: p.contact.email, url: `mailto:${p.contact.email}` })
  if (p.contact.phone) contacts.push({ label: 'Phone', text: p.contact.phone })
  if (p.contact.location) contacts.push({ label: 'Location', text: p.contact.location })
  for (const l of p.links) contacts.push({ label: l.label, text: shortUrl(l.url), url: l.url })
  return { name: p.fullName || p.displayName, headline, contacts }
}

/** One general CV from the profile. With an inventory it ranks projects for the master; without one it lists them as recorded. */
export function buildMaster(p: Profile): CvBuild {
  const log: ChangeLogEntry[] = []
  const ranked = p.projects.filter((x) => typeof x.master === 'number').sort((a, b) => a.master! - b.master!)
  const main = ranked.length ? ranked : p.projects
  const projects: ResumeSection = { id: id('sec'), title: ranked.length ? 'Selected Technical Projects' : 'Projects', kind: 'projects', items: main.map((x) => projectItem(x, null, x.masterBullets ?? 99)) }
  const extra = p.projects.filter((x) => x.additional)
  const additional: ResumeSection | null = extra.length ? { id: id('sec'), title: 'Additional Projects', kind: 'skills', skillGroups: extra.map((x) => ({ label: x.additionalLabel ?? x.title, values: [x.additional!], factIds: [`project:${x.id ?? x.title}`] })) } : null
  const sections = (ranked.length
    ? [educationSection(p), projects, additional, skillsSection(p, null, false, log), awardsSection(p), leadershipSection(p, null, false, log), experienceSection(p)]
    : [educationSection(p), skillsSection(p, null, false, log), projects, experienceSection(p), leadershipSection(p, null, false, log)]).filter(Boolean) as ResumeSection[]
  const ast: ResumeAST = { schema: 1, language: 'en', target: { company: 'General', role: 'Master resume' }, header: header(p, p.master?.headline), summary: { text: p.master?.summary || summaryFor(p, null, null), factIds: [] }, sections, changelog: log }
  return { ast, changes: [], flags: openQuestions(p), label: 'Master resume' }
}

/** Company/role CV. With no vacancy text this is labelled as a company/role estimate, never as a vacancy match. */
export function buildTailored(p: Profile, t: CvTarget): CvBuild {
  const role = t.role
  const log: ChangeLogEntry[] = []
  const ranked = p.projects.map((x, i) => ({ x, i, r: (textRelevance([x.title, ...x.stack, ...(x.themes ?? [])].join(' '), role) + (x.themes?.includes(role ?? '') ? 0.25 : 0)) * (0.6 + 0.4 * projectWeight(x)) * (x.master == null && x.additional ? 0.85 : 1) })).sort((a, b) => b.r - a.r || a.i - b.i)
  const kept = ranked.filter((r) => r.x.contribution !== 'TEAM_UNCERTAIN').filter((r) => !p.projects.some((x) => x.bullets?.length) || r.x.bullets?.length).filter((r, i) => i < 3 || r.r >= 0.2).slice(0, p.projects.some((x) => x.bullets?.length) ? 5 : 4)
  for (const r of ranked.slice(4)) log.push({ kind: 'omitted', section: 'Projects', reason: `${r.x.title} left out. It shows the least of what ${role ? ROLE_LABEL[role] : 'this role'} asks for.` })
  if (kept[0] && kept[0].i !== 0) log.push({ kind: 'ordered', section: 'Projects', reason: `${kept[0].x.title} moved first: it shows the most ${role ? ROLE_LABEL[role].toLowerCase() : 'role'} tools.` })
  const projects: ResumeSection = { id: id('sec'), title: 'Projects', kind: 'projects', items: kept.map((k, i) => projectItem(k.x, role, i < 2 ? 4 : 2)) }
  const edu = educationSection(p), skills = skillsSection(p, role, true, log), exp = experienceSection(p), lead = leadershipSection(p, role, true, log), aw = awardsSection(p)
  const lead4 = lead
  // Section order: students lead with the evidence that matters most for the role.
  const projectsFirst = (kept[0]?.r ?? 0) >= 0.25
  const sections = (projectsFirst ? [edu, projects, skills, aw, lead4, exp] : [edu, skills, projects, aw, lead4, exp]).filter(Boolean) as ResumeSection[]
  const sum = summaryFor(p, role, t.company)
  log.push({ kind: 'edited', section: 'Summary', reason: `Rewritten for ${t.company}${role ? ` and ${ROLE_LABEL[role]}` : ''} using only skills and projects already in the profile.` })
  const ast: ResumeAST = { schema: 1, language: 'en', target: { company: t.company, role: role ? ROLE_LABEL[role] : 'General', focus: t.vacancy === 'NONE' ? 'Company/Role Tailored — No Specific Vacancy Description' : undefined }, header: header(p, p.master?.headline), summary: { text: sum, factIds: [] }, sections, changelog: log }
  return { ast, changes: [], flags: openQuestions(p), label: `${t.company} — ${role ? ROLE_LABEL[role] : 'General'}` }
}

const openQuestions = (p: Profile) => p.reviewNotes.filter((x) => /confirm|check|unresolved/i.test(x)).slice(0, 4)

/* ---- reading a CV back ---- */
export const lines = (ast: ResumeAST): { where: string; text: string }[] => {
  const out: { where: string; text: string }[] = []
  if (ast.summary) out.push({ where: 'Summary', text: ast.summary.text })
  for (const s of ast.sections) {
    for (const g of s.skillGroups ?? []) out.push({ where: s.title, text: `${g.label}: ${g.values.join(', ')}` })
    for (const it of s.items ?? []) { out.push({ where: s.title, text: it.heading + (it.subheading ? ` — ${it.subheading}` : '') + (it.dates ? ` (${it.dates})` : '') }); for (const b of it.bullets) out.push({ where: `${s.title} › ${it.heading}`, text: b.text }) }
  }
  return out
}
export const plainText = (ast: ResumeAST) => [ast.header.name, ast.header.contacts.map((c) => c.text).join(' | '), ...lines(ast).map((l) => l.text)].join('\n')

/** Before/after view: what was added, removed, reordered or reworded, each with a reason where the engine logged one. */
export function diffCv(before: ResumeAST, after: ResumeAST): CvChange[] {
  const out: CvChange[] = []
  const why = (section: string, kinds: string[]) => after.changelog.filter((c) => c.section === section && kinds.includes(c.kind)).map((c) => c.reason).join(' ')
  if (before.summary?.text !== after.summary?.text) out.push({ kind: 'reworded', where: 'Summary', text: after.summary?.text ?? '', why: why('Summary', ['edited']) || 'Summary updated.' })
  const bt = before.sections.map((s) => s.title), at = after.sections.map((s) => s.title)
  const common = bt.filter((t) => at.includes(t))
  if (common.join('|') !== at.filter((t) => common.includes(t)).join('|')) out.push({ kind: 'moved', where: 'Section order', text: at.join(' → '), why: 'Sections reordered so the strongest evidence for this role comes first.' })
  for (const s of after.sections) {
    const b = before.sections.find((x) => x.title === s.title)
    if (!b) { out.push({ kind: 'added', where: s.title, text: s.title, why: 'New section.' }); continue }
    const bh = (b.items ?? []).map((i) => i.heading), ah = (s.items ?? []).map((i) => i.heading)
    for (const h of ah.filter((x) => !bh.includes(x))) out.push({ kind: 'added', where: s.title, text: h, why: why(s.title, ['included']) || 'Added.' })
    for (const h of bh.filter((x) => !ah.includes(x))) out.push({ kind: 'removed', where: s.title, text: h, why: after.changelog.find((c) => c.kind === 'omitted' && c.section === s.title && c.reason.startsWith(h.split(',')[0]))?.reason ?? why(s.title, ['omitted']) ?? 'Left out.' })
    const bc = bh.filter((x) => ah.includes(x)), ac = ah.filter((x) => bh.includes(x))
    if (bc.join('|') !== ac.join('|')) out.push({ kind: 'moved', where: s.title, text: ac.join(' → '), why: why(s.title, ['ordered']) || 'Reordered by relevance.' })
    const bg = (b.skillGroups ?? []).map((g) => g.label), ag = (s.skillGroups ?? []).map((g) => g.label)
    for (const h of bg.filter((x) => !ag.includes(x))) out.push({ kind: 'removed', where: s.title, text: h, why: after.changelog.find((c) => c.kind === 'omitted' && c.section === 'Skills' && c.reason.includes(`"${h}"`))?.reason ?? 'Left out.' })
    if (bg.filter((x) => ag.includes(x)).join('|') !== ag.filter((x) => bg.includes(x)).join('|')) out.push({ kind: 'moved', where: s.title, text: ag.join(' → '), why: why('Skills', ['ordered']) || 'Reordered by relevance.' })
    for (const g of s.skillGroups ?? []) { const o = b.skillGroups?.find((x) => x.label === g.label); if (o && o.values.join() !== g.values.join()) out.push({ kind: 'emphasised', where: `Skills › ${g.label}`, text: g.values.slice(0, 5).join(', '), why: 'Skills this role asks for listed first.' }) }
  }
  return out
}

/* ---- honesty checks ---- */
function corpus(p: Profile) {
  return [p.fullName, p.summary, p.degree, p.specialisation, ...p.education.flatMap((e) => [e.title, e.institution, ...e.points]), ...p.skills.flatMap((s) => [s.group, ...s.items]),
    ...p.projects.flatMap((x) => [x.title, x.context, x.date, ...x.stack, ...x.points, x.additional ?? '', x.purpose ?? '', ...(x.bullets ?? []).map((b) => b.text)]), ...(p.awards ?? []).flatMap((a) => [a.title, a.detail, a.date]), p.master?.summary ?? '', p.master?.headline ?? '', ...p.experience.flatMap((e) => [e.title, e.organisation, e.date, ...e.points]),
    ...p.leadership.flatMap((e) => [e.title, e.organisation, e.date, ...e.points]), ...p.interests].join('\n')
}
/** Claims in a CV that the profile does not support: technologies and figures not found in the student's own facts. */
export function unsupportedClaims(p: Profile, ast: ResumeAST): string[] {
  const have = new Set(conceptsIn(corpus(p))); const c = corpus(p).toLowerCase()
  const out: string[] = []
  // The target role and company names are labels, not claims.
  let body = lines(ast).map((l) => l.text).join('\n')
  for (const label of [ast.target.role, ast.target.company]) if (label && label.length > 3) body = body.split(label).join(' ').split(label.toLowerCase()).join(' ')
  for (const k of conceptsIn(body)) if (!have.has(k)) out.push(`"${conceptLabel(k)}" appears in this CV but not in your profile.`)
  for (const m of body.match(/\b\d+(?:\.\d+)?\s?(?:%|x|k\b|users|clicks|hours)|RM\s?\d[\d,]*/gi) ?? []) if (!c.includes(m.toLowerCase().replace(/\s+/g, ' ')) && !c.replace(/\s+/g, '').includes(m.toLowerCase().replace(/\s+/g, ''))) out.push(`"${m}" is not in your profile.`)
  if (/\b(completed|deployed|benchmarked|published)\b/i.test(body)) for (const pr of p.projects.filter((x) => x.status === 'PROPOSED')) if (new RegExp(`${pr.title.slice(0, 20)}[^\\n]{0,200}\\b(completed|deployed|benchmarked)\\b`, 'i').test(body)) out.push(`"${pr.title}" is proposed / in progress, but this CV describes it as finished.`)
  if (/\[[^\]]*\]|lorem|todo|placeholder|\bXXX\b/i.test(body)) out.push('The CV contains a placeholder.')
  return [...new Set(out)]
}

/** Evidence presentation: how much of the role's typical tooling that the student CAN evidence is visible near the top of the CV. Separate from suitability. */
export function evidenceCoverage(p: Profile, ast: ResumeAST, role: RoleFamily | null) {
  const needs = needsOf(role); const credit = studentCredit(p as unknown as StudentFacts)
  const visible = [ast.summary?.text ?? '', ...(ast.sections.find((s) => s.kind === 'skills')?.skillGroups ?? []).slice(0, 1).flatMap((g) => g.values), ...(ast.sections.find((s) => s.kind === 'projects')?.items ?? []).slice(0, 2).flatMap((i) => [i.heading, ...i.bullets.map((b) => b.text)])].join('\n')
  const seen = new Set(conceptsIn(visible))
  const evidencable = needs.filter(([k]) => (credit.get(k)?.credit ?? 0) > 0)
  const w = evidencable.reduce((a, [, x]) => a + x, 0)
  const shown = evidencable.reduce((a, [k, x]) => a + (seen.has(k) ? x : 0), 0)
  return { percent: w ? Math.round((100 * shown) / w) : 0, shown: evidencable.filter(([k]) => seen.has(k)).map(([k]) => conceptLabel(k)), hidden: evidencable.filter(([k]) => !seen.has(k)).map(([k]) => conceptLabel(k)), gaps: needs.filter(([k]) => !(credit.get(k)?.credit)).map(([k]) => conceptLabel(k)) }
}

export const fileNameFor = (p: Profile, company: string, role: string | null) =>
  `${p.displayName}_${company.replace(/\(.*?\)/g, '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28)}_${(role ?? 'General').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}_CV.pdf`
