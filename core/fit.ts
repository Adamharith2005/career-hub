import { findTech, type RoleFamily, roleLabel } from './domain.ts'
import type { JobSpec, Warning } from './job.ts'
import { scamFlags } from './job.ts'
import type { Fact, Profile } from './profiles.ts'

export const WEIGHTS = { tech: 0.30, proj: 0.25, acad: 0.15, role: 0.15, locComp: 0.10, org: 0.05 }
export type Recommendation = 'APPLY_NOW' | 'APPLY_WITH_CAVEATS' | 'HOLD_INVESTIGATE' | 'SKIP'
export const REC_LABEL: Record<Recommendation, string> = {
  APPLY_NOW: 'Apply now', APPLY_WITH_CAVEATS: 'Apply with caveats', HOLD_INVESTIGATE: 'Hold & investigate', SKIP: 'Skip',
}

export interface GateResult { kind: string; text: string; status: 'met' | 'unknown' | 'failed'; note: string; mandatory: boolean }
export interface Assessment {
  score: number | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  recommendation: Recommendation
  gateMultiplier: number
  components: Record<keyof typeof WEIGHTS, number>
  gates: GateResult[]
  matched: { requirement: string; factIds: string[]; titles: string[] }[]     // evidenced in a project / experience
  partial: { requirement: string; factIds: string[]; titles: string[] }[]     // only listed as a skill
  missing: string[]
  preferredMatched: string[]; preferredMissing: string[]
  proofs: { factId: string; title: string; overlap: string[] }[]
  risks: string[]
  reasons: string[]
  warnings: Warning[]
  disclaimer: string
  computedAt: string
}
const DISCLAIMER = 'Explainable heuristic computed locally from your confirmed facts. It is NOT an ATS score and not a prediction of employer decisions.'

const ADJ: Record<string, string[]> = {
  swe: ['frontend', 'backend', 'cloud_devops', 'qa'], frontend: ['swe'], backend: ['swe', 'cloud_devops', 'data'], ai_ml: ['data', 'swe'], data: ['ai_ml', 'backend'],
  cyber: ['cloud_devops', 'it_support'], cloud_devops: ['it_support', 'backend', 'cyber', 'swe'], qa: ['swe'], it_support: ['cloud_devops', 'cyber'], other: [],
}

export function assess(input: {
  profile: Profile; facts: Fact[]; spec: JobSpec; jobText: string
  company?: { status_enum?: string | null; last_verified?: string | null; hr_email?: string | null; name?: string; address?: string | null } | null
  careerType?: 'INTERNSHIP' | 'GRADUATE'; now?: Date
}): Assessment {
  const { profile, spec, company } = input
  const facts = input.facts.filter((f) => f.confirmed)               // unconfirmed facts never count as evidence
  const warnings: Warning[] = [...scamFlags(input.jobText, spec.company ?? company?.name)]
  const risks: string[] = []
  const skillFacts = facts.filter((f) => f.category === 'SKILL')
  const workFacts = facts.filter((f) => ['PROJECT', 'EXPERIENCE', 'LEADERSHIP'].includes(f.category))
  const edu = facts.filter((f) => f.category === 'EDUCATION')

  // --- technical match (verified skills only)
  const factTech = (f: Fact) => new Set(findTech([f.title, f.claim_text, f.tools.join(' ')].join('\n')))
  const matched: Assessment['matched'] = [], partial: Assessment['partial'] = [], missing: string[] = []
  const evalReq = (t: string) => {
    const work = workFacts.filter((f) => factTech(f).has(t))
    if (work.length) return { kind: 'matched' as const, ids: work.map((f) => f.fact_id), titles: work.map((f) => f.title) }
    const sk = skillFacts.filter((f) => factTech(f).has(t))
    if (sk.length) return { kind: 'partial' as const, ids: sk.map((f) => f.fact_id), titles: sk.map((f) => f.title) }
    return { kind: 'missing' as const, ids: [], titles: [] }
  }
  let reqPoints = 0
  for (const t of spec.required) {
    const r = evalReq(t)
    if (r.kind === 'matched') { matched.push({ requirement: t, factIds: r.ids, titles: r.titles }); reqPoints += 1 }
    else if (r.kind === 'partial') { partial.push({ requirement: t, factIds: r.ids, titles: r.titles }); reqPoints += 0.6 }
    else missing.push(t)
  }
  const preferredMatched: string[] = [], preferredMissing: string[] = []
  for (const t of spec.preferred) (evalReq(t).kind === 'missing' ? preferredMissing : preferredMatched).push(t)
  const tReq = spec.required.length ? reqPoints / spec.required.length : 0.4
  const tPref = spec.preferred.length ? preferredMatched.length / spec.preferred.length : tReq
  const sTech = spec.preferred.length ? 0.85 * tReq + 0.15 * tPref : tReq

  // --- project depth
  const wanted = new Set([...spec.required, ...spec.preferred])
  const proofs = workFacts.map((f) => ({ f, overlap: [...factTech(f)].filter((t) => wanted.has(t)) }))
    .filter((p) => p.overlap.length).sort((a, b) => b.overlap.length - a.overlap.length)
  const best = proofs[0] ? Math.min(1, proofs[0].overlap.length / Math.max(1, Math.min(wanted.size, 4))) : 0
  const sProj = wanted.size ? 0.65 * best + 0.35 * Math.min(1, proofs.length / 2) : (workFacts.length ? 0.4 : 0)

  // --- academic
  const sAcad = edu.length ? 0.8 : 0.3

  // --- role alignment
  const roles = profile.roles as string[]
  const sRole = roles.includes(spec.roleFamily) ? (profile.primary_role === spec.roleFamily ? 1 : 0.85)
    : roles.some((r) => (ADJ[r] ?? []).includes(spec.roleFamily)) ? 0.5 : spec.roleFamily === 'other' ? 0.4 : 0.2
  if (sRole <= 0.2) risks.push(`This looks like a ${roleLabel(spec.roleFamily)} role, outside the roles you selected.`)

  // --- location / compensation
  const region = (profile.region ?? 'Cyberjaya').toLowerCase()
  const loc = (spec.location ?? '').toLowerCase()
  const sLoc = !loc ? 0.6 : loc.includes(region) || /remote/.test(loc) || spec.workMode === 'remote' ? 1 : /kuala lumpur|petaling|shah alam|putrajaya|selangor/.test(loc) ? 0.6 : 0.3
  if (loc && sLoc < 0.6) risks.push(`Location (${spec.location}) is far from your target region (${profile.region}).`)
  const sLocComp = 0.7 * sLoc + 0.3 * 0.5

  // --- organisation channel quality
  const st = company?.status_enum
  const sOrg = st === 'VERIFIED_ACTIVE_VACANCY' ? 1 : st === 'DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING' ? 0.75 : st === 'PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK' ? 0.6 : st ? 0.5 : 0.5

  // --- gates
  const gates: GateResult[] = []
  for (const g of spec.gates) {
    if (g.kind === 'degree') {
      gates.push(edu.length ? { ...g, status: 'met', note: 'You have a confirmed education entry — check the programme/level matches.' }
        : { ...g, status: 'unknown', note: 'Add your education to the profile to check this.' })
    } else if (g.kind === 'duration') {
      const w = profile.prefs.durationWeeks
      if (!w || !spec.durationMonthsMin) gates.push({ ...g, status: 'unknown', note: 'Set your internship duration in My Profile to check this.' })
      else if (w / 4.345 + 0.25 < spec.durationMonthsMin) gates.push({ ...g, status: 'failed', note: `You are available ~${(w / 4.345).toFixed(1)} months; the posting needs ${spec.durationMonthsMin}+.` })
      else gates.push({ ...g, status: 'met', note: `Your ~${(w / 4.345).toFixed(1)} months covers ${spec.durationMonthsMin} months.` })
    } else if (g.kind === 'citizenship') {
      const c = (profile.prefs as any).citizenship as string | undefined
      const mustMy = /malaysian|warganegara/i.test(g.text)
      if (!mustMy) gates.push({ ...g, status: 'unknown', note: 'Check the citizenship / work-authorisation wording.' })
      else if (c === 'malaysian') gates.push({ ...g, status: 'met', note: 'You set Malaysian citizenship in your profile.' })
      else if (c === 'other') gates.push({ ...g, status: 'failed', note: 'The posting requires Malaysian citizenship.' })
      else gates.push({ ...g, status: 'unknown', note: 'Set your citizenship in My Profile to check this.' })
    }
  }
  const failed = gates.some((g) => g.status === 'failed' && g.mandatory)
  const unknownGate = gates.some((g) => g.status === 'unknown' && g.mandatory)
  const gateMultiplier = failed ? 0 : unknownGate ? 0.65 : 1

  // --- staleness / contact warnings
  if (company) {
    if (company.status_enum === 'VERIFIED_ACTIVE_VACANCY') warnings.push({ code: 'HISTORICAL_STATUS', severity: 'info', text: 'Seed research recorded an advertised listing in Nov 2026. Confirm it is still open on the official portal.' })
    if (company.last_verified) {
      const age = Math.floor(((input.now ?? new Date()).getTime() - new Date(company.last_verified).getTime()) / 86400000)
      if (age > 90) warnings.push({ code: 'STALE_RESEARCH', severity: 'medium', text: `Company research was last verified ${age} days ago — re-check before relying on it.` })
    }
    if (!company.hr_email) warnings.push({ code: 'NO_VERIFIED_EMAIL', severity: 'info', text: 'No verified recruitment email is on record. Use the official careers portal, or enter an address you have confirmed yourself.' })
  }
  if (!spec.pay) warnings.push({ code: 'PAY_UNVERIFIED', severity: 'info', text: 'No pay is stated in the posting. Allowance/salary is unverified.' })
  if (spec.unknowns.length) for (const u of spec.unknowns) risks.push(u)

  const hasEvidence = facts.length > 0
  const total = 100 * gateMultiplier * (WEIGHTS.tech * sTech + WEIGHTS.proj * sProj + WEIGHTS.acad * sAcad + WEIGHTS.role * sRole + WEIGHTS.locComp * sLocComp + WEIGHTS.org * sOrg)
  const score = hasEvidence ? Math.round(total) : null

  let confidence: Assessment['confidence'] = 'MEDIUM'
  if (!hasEvidence || (spec.required.length === 0 && input.jobText.length < 300) || spec.unknowns.length >= 2) confidence = 'LOW'
  else if (spec.required.length >= 3 && !unknownGate && workFacts.length >= 1 && !spec.unknowns.length) confidence = 'HIGH'

  const hasHighScam = warnings.some((w) => w.severity === 'high')
  let rec: Recommendation
  if (!hasEvidence) rec = 'HOLD_INVESTIGATE'
  else if (hasHighScam || failed) rec = 'SKIP'
  else if ((score ?? 0) >= 78 && confidence !== 'LOW') rec = 'APPLY_NOW'
  else if ((score ?? 0) >= 60) rec = confidence === 'LOW' ? 'HOLD_INVESTIGATE' : 'APPLY_WITH_CAVEATS'
  else if ((score ?? 0) >= 50 && (confidence === 'LOW' || unknownGate)) rec = 'HOLD_INVESTIGATE'
  else rec = 'SKIP'

  const reasons: string[] = []
  if (!hasEvidence) reasons.push('No confirmed facts yet — confirm your profile so the match can use real evidence.')
  if (hasHighScam) reasons.push('Scam indicators were found in the posting; do not apply until verified.')
  if (failed) reasons.push(gates.find((g) => g.status === 'failed')!.note)
  if (matched.length) reasons.push(`Project evidence for ${matched.slice(0, 4).map((m) => m.requirement).join(', ')}${matched.length > 4 ? '…' : ''}.`)
  if (partial.length) reasons.push(`Listed as skills but no project proof: ${partial.slice(0, 3).map((m) => m.requirement).join(', ')}.`)
  if (missing.length) reasons.push(`Missing required skills: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}.`)
  if (unknownGate && !failed) reasons.push('A mandatory eligibility requirement could not be checked — confirm it yourself.')
  if (roles.includes(spec.roleFamily)) reasons.push(`Matches your ${roleLabel(spec.roleFamily as RoleFamily)} focus.`)
  return {
    score, confidence, recommendation: rec, gateMultiplier,
    components: { tech: sTech, proj: sProj, acad: sAcad, role: sRole, locComp: sLocComp, org: sOrg },
    gates, matched, partial, missing, preferredMatched, preferredMissing,
    proofs: proofs.slice(0, 4).map((p) => ({ factId: p.f.fact_id, title: p.f.title, overlap: p.overlap })),
    risks, reasons: reasons.slice(0, 3), warnings, disclaimer: DISCLAIMER, computedAt: new Date().toISOString(),
  }
}
