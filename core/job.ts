import { classifyRoleFamilies, findTech, type RoleFamily } from './domain.ts'

export interface Gate { kind: 'degree' | 'duration' | 'citizenship' | 'other'; text: string; mandatory: boolean }
export interface Pay { text: string; min: number | null; max: number | null; period: 'month' | 'year' | 'unknown'; source: 'JOB_POST' }
export interface JobSpec {
  company: string | null; title: string | null; roleFamily: RoleFamily; level: 'INTERNSHIP' | 'GRADUATE' | 'UNKNOWN'
  location: string | null; workMode: 'onsite' | 'hybrid' | 'remote' | null
  durationText: string | null; durationMonthsMin: number | null; deadline: string | null
  required: string[]; preferred: string[]; responsibilities: string[]; gates: Gate[]; pay: Pay | null
  unknowns: string[]; extraction: 'heuristic' | 'ai'; verifiedAt: string
}

const SEC_REQ = /^(requirements?|qualifications?|what you('|’)?ll need|what we('|’)?re looking for|skills?( required)?|must[- ]have|required( skills)?|you (have|bring)|syarat|kelayakan)/i
const SEC_PREF = /^(preferred|nice[- ]to[- ]have|good[- ]to[- ]have|bonus|advantage|added advantage|plus|desirable)/i
const SEC_RESP = /^(responsibilit(y|ies)|what you('|’)?ll do|duties|job description|the role|about the (role|job|internship)|your role|tugas)/i
const BULLET = /^\s*[•\-–—·*▪●◦■►\d.)]+\s*/

export function parseJobText(text: string, hints: { company?: string; title?: string } = {}): JobSpec {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const unknowns: string[] = []
  let mode: 'req' | 'pref' | 'resp' | null = null
  const bucket: Record<'req' | 'pref' | 'resp', string[]> = { req: [], pref: [], resp: [] }
  const other: string[] = []
  for (const l of lines) {
    const head = l.replace(/[:：]\s*$/, '')
    const isHead = head.length < 60 && (/[:：]\s*$/.test(l) || !/[.,;]/.test(l)) && !BULLET.test(l)
    if (isHead && SEC_PREF.test(head)) { mode = 'pref'; continue }
    if (isHead && SEC_REQ.test(head)) { mode = 'req'; continue }
    if (isHead && SEC_RESP.test(head)) { mode = 'resp'; continue }
    if (isHead && /^(benefits?|about us|company|how to apply|what we offer|perks)/i.test(head)) { mode = null; continue }
    if (mode) bucket[mode].push(l.replace(BULLET, '')); else other.push(l)
  }
  const reqTech = findTech(bucket.req.join('\n'))
  const prefTech = findTech(bucket.pref.join('\n')).filter((t) => !reqTech.includes(t))
  const mentioned = findTech(text).filter((t) => !reqTech.includes(t) && !prefTech.includes(t))
  let required = reqTech
  if (!reqTech.length && mentioned.length) {
    required = mentioned
    unknowns.push('Required vs preferred skills could not be separated, so every technology mentioned is treated as required.')
  }
  const labelled = (re: RegExp) => lines.map((l) => l.match(re)).find(Boolean)?.[1]?.trim() ?? null
  const titleLabel = labelled(/^(?:position|job title|role|title|jawatan)\s*[:\-–]\s*(.+)$/i)
  const companyLabel = labelled(/^(?:company|employer|organi[sz]ation|syarikat)\s*[:\-–]\s*(.+)$/i)
  const firstLine = lines[0] && lines[0].length < 100 && /intern|engineer|developer|analyst|tester|admin|officer|executive|trainee|programmer|scientist|support|latihan industri|graduate/i.test(lines[0]) ? lines[0] : null
  let title = hints.title || titleLabel || firstLine
  let company = hints.company || companyLabel
  const at = title?.match(/^(.*?)\s+(?:@|at)\s+(.+)$/i)
  if (at) { title = at[1].trim(); company = company || at[2].trim() }
  if (!title) unknowns.push('Job title not found')
  if (!company) unknowns.push('Company name not found')

  const level: JobSpec['level'] = /intern(ship)?\b|latihan industri|industrial training|practicum|trainee/i.test(text) ? 'INTERNSHIP'
    : /graduate|entry[- ]level|fresh grad|junior|associate/i.test(text) ? 'GRADUATE' : 'UNKNOWN'
  const loc = text.match(/\b(Cyberjaya|Putrajaya|Kuala Lumpur|KL Sentral|Bangsar South|Petaling Jaya|Shah Alam|Selangor|Penang|Johor|Remote)\b/i)?.[1] ?? null
  const workMode = /hybrid/i.test(text) ? 'hybrid' : /fully remote|100% remote|work from home|remote/i.test(text) ? 'remote' : /on-?site|onsite|work from office|in-office/i.test(text) ? 'onsite' : null
  const dm = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(months?|weeks?|bulan|minggu)/i) ?? text.match(/(\d+)\s*()(months?|weeks?|bulan|minggu)/i)
  let durationMonthsMin: number | null = null, durationText: string | null = null
  if (dm) {
    const unit = /week|minggu/i.test(dm[3]) ? 1 / 4.345 : 1
    durationMonthsMin = Math.round(Number(dm[1]) * unit * 10) / 10
    durationText = dm[0]
  }
  const deadline = text.match(/(?:deadline|closing date|apply (?:by|before)|tarikh tutup)\s*[:\-–]?\s*([^\n.;]{4,30})/i)?.[1]?.trim() ?? null

  let pay: Pay | null = null
  const pm = text.match(/RM\s?([\d,]+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(?:RM\s?)?([\d,]+(?:\.\d+)?))?\s*(?:\/|per|a)?\s*(month|mth|bulan|year|annum|pa)?/i)
  if (pm && /allowance|elaun|salary|gaji|stipend|pay|remuneration|compensation|per month|\/month/i.test(text)) {
    const min = Number(pm[1].replace(/,/g, '')), max = pm[2] ? Number(pm[2].replace(/,/g, '')) : null
    pay = { text: pm[0].trim(), min, max, period: /year|annum|pa/i.test(pm[3] ?? '') ? 'year' : /month|mth|bulan/i.test(pm[3] ?? '') || min < 20000 ? 'month' : 'unknown', source: 'JOB_POST' }
  }

  const gates: Gate[] = []
  const lc = text.split(/\n/)
  const degLine = lc.find((l) => /(pursuing|currently (studying|enrolled)|final year|undergraduate|bachelor|diploma|degree|student)/i.test(l))
  if (degLine) gates.push({ kind: 'degree', text: degLine.trim().slice(0, 160), mandatory: /must|required|only|should be|currently/i.test(degLine) })
  if (durationText) gates.push({ kind: 'duration', text: `Duration: ${durationText}`, mandatory: true })
  const cit = lc.find((l) => /malaysian (citizen|only)|warganegara|citizenship|citizen/i.test(l))
  if (cit) gates.push({ kind: 'citizenship', text: cit.trim().slice(0, 160), mandatory: true })

  const family = classifyRoleFamilies(`${title ?? ''}`)[0] ?? classifyRoleFamilies(text.slice(0, 600))[0] ?? 'other'
  return {
    company, title, roleFamily: family as RoleFamily, level, location: loc, workMode, durationText, durationMonthsMin, deadline,
    required, preferred: prefTech.concat(reqTech.length ? mentioned : []), responsibilities: bucket.resp.slice(0, 8), gates, pay, unknowns,
    extraction: 'heuristic', verifiedAt: new Date().toISOString(),
  }
}

// ------------------------------------------------------------------ warnings
export interface Warning { code: string; severity: 'high' | 'medium' | 'info'; text: string }

export function scamFlags(text: string, companyName?: string | null): Warning[] {
  const w: Warning[] = []
  if (/(registration|processing|training|deposit|admin|security) fee|pay (a|an|the)? ?(fee|deposit)|bayaran (pendaftaran|yuran)/i.test(text))
    w.push({ code: 'UPFRONT_FEE', severity: 'high', text: 'The ad mentions a fee or deposit. Legitimate employers do not charge applicants.' })
  if (/(whatsapp|telegram)/i.test(text) && /(daily pay|per day|per hari|work from home|easy income|earn up to|commission only)/i.test(text))
    w.push({ code: 'MESSAGING_DAILY_PAY', severity: 'high', text: 'Recruitment through WhatsApp/Telegram with daily-pay promises is a common scam pattern.' })
  if (/(mykad|nric|ic number|no\.? ?kad pengenalan|bank (account|details)|tac|otp|password)/i.test(text) && /(send|provide|submit|share|hantar)/i.test(text))
    w.push({ code: 'EARLY_SENSITIVE_DATA', severity: 'high', text: 'The ad asks for sensitive documents/credentials (MyKad, bank details, OTP/TAC) before any interview.' })
  const free = text.match(/[\w.+-]+@(gmail|yahoo|hotmail|outlook|live)\.[a-z.]+/i)
  if (free && companyName && /(dell|deriv|hsbc|dhl|bmw|accenture|ericsson|fujitsu|experian|aia|rbc|hp)\b/i.test(companyName))
    w.push({ code: 'FREE_EMAIL_MNC', severity: 'medium', text: `A free-mail address (${free[0]}) is used for a large company. Verify through the official careers page.` })
  if (/guaranteed (job|income)|no experience needed.*(rm\s?\d{4,})/i.test(text))
    w.push({ code: 'TOO_GOOD', severity: 'medium', text: 'The ad promises guaranteed income or unusually high pay for no experience.' })
  return w
}

// ------------------------------------------------------------------ compensation
export interface Compensation {
  source: 'JOB_POST' | 'UNKNOWN'; kind: 'ALLOWANCE' | 'SALARY'; headline: string; amountText: string | null; min: number | null; max: number | null
  confidence: 'high' | 'low'; checkedAt: string | null
  reference?: { min: number; max: number; label: string; note: string }
  suggestedWording?: string
}

const BENCH = {
  mnc: { ALLOWANCE: [1200, 2200], SALARY: [4200, 6500], tier: 'Large tech MNC / fintech' },
  glc: { ALLOWANCE: [1000, 1500], SALARY: [3500, 4800], tier: 'GLC / listed company' },
  gov: { ALLOWANCE: [800, 1200], SALARY: [3000, 4200], tier: 'Government / statutory agency' },
  sme: { ALLOWANCE: [700, 1200], SALARY: [3000, 4200], tier: 'Local SME / data centre' },
} as const

export function compensationFor(spec: JobSpec | null, ownership: string | null | undefined, careerType: 'INTERNSHIP' | 'GRADUATE'): Compensation {
  const kind = careerType === 'INTERNSHIP' ? 'ALLOWANCE' : 'SALARY'
  if (spec?.pay) {
    const p = spec.pay
    const rng = p.max ? `RM${p.min?.toLocaleString()} – RM${p.max.toLocaleString()}` : `RM${p.min?.toLocaleString()}`
    return { source: 'JOB_POST', kind, headline: `${rng} ${p.period === 'year' ? 'per year' : 'per month'}`, amountText: p.text, min: p.min, max: p.max, confidence: 'high', checkedAt: spec.verifiedAt.slice(0, 10) }
  }
  const o = (ownership ?? '').toLowerCase()
  const group = /government|statutory|agency/.test(o) ? 'gov' : /glc|glic|plc/.test(o) ? 'glc' : /mnc/.test(o) ? 'mnc' : 'sme'
  const b = BENCH[group]
  const [min, max] = b[kind]
  return {
    source: 'UNKNOWN', kind, headline: 'Not verified', amountText: null, min: null, max: null, confidence: 'low', checkedAt: null,
    reference: { min, max, label: `${b.tier} reference`, note: 'Unsourced estimate from the Nov 2026 seed research report — not a live figure. Verify on the posting or ask the employer.' },
    suggestedWording: `RM${min.toLocaleString()} – RM${max.toLocaleString()}/month (negotiable in line with company ${kind === 'ALLOWANCE' ? 'internship' : 'salary'} guidelines)`,
  }
}
