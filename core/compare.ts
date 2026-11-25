/**
 * Explainable comparison of 2–4 employers. Scores describe how well recorded evidence matches a chosen priority.
 * They are not a prediction of hiring success. When too little is known, no winner is declared.
 */
export type Priority = 'balanced' | 'learning' | 'allowance' | 'swe' | 'cyber' | 'contact' | 'opening'

export interface CompareInput {
  company_id: string; name: string
  role_families: string[]; tech_departments?: string | null
  allowance_grade: string; allowance_monthly_min: number | null
  internship_evidence: string; verification_level: string
  hr_email?: string | null; general_contact?: string | null; careers_page?: string | null
  last_verified?: string | null
}
export interface Criterion { key: string; label: string; value: number | null; note: string }
export interface Scored { company_id: string; name: string; score: number | null; known: number; criteria: Criterion[] }
export interface CompareResult { scored: Scored[]; winnerId: string | null; reason: string }

const WEIGHTS: Record<Priority, Record<string, number>> = {
  balanced: { technical: 2, allowance: 1, contact: 1, opening: 1, freshness: 1 },
  learning: { technical: 4, opening: 1, freshness: 1 },
  allowance: { allowance: 5, freshness: 1 },
  swe: { swe: 5, technical: 1 },
  cyber: { cyber: 5, technical: 1 },
  contact: { contact: 4, opening: 1 },
  opening: { opening: 4, contact: 1, freshness: 1 },
}

export function criteriaFor(c: CompareInput, today: Date): Criterion[] {
  const fams = c.role_families.filter((r) => r !== 'other')
  const monthsOld = c.last_verified ? (today.getTime() - new Date(c.last_verified).getTime()) / (30 * 86400000) : null
  const email = !!c.hr_email || /@/.test(c.general_contact ?? '')
  return [
    { key: 'technical', label: 'Technical breadth', value: fams.length || c.tech_departments ? Math.min(1, fams.length / 4 + (c.tech_departments ? 0.25 : 0)) : null, note: fams.length ? `${fams.length} role area(s) recorded` : 'No role areas recorded' },
    { key: 'swe', label: 'Software engineering relevance', value: fams.length ? (fams.some((f) => ['swe', 'frontend', 'backend'].includes(f)) ? 1 : 0) : null, note: 'Based on recorded role areas' },
    { key: 'cyber', label: 'Cybersecurity relevance', value: fams.length ? (fams.includes('cyber') ? 1 : 0) : null, note: 'Based on recorded role areas' },
    // Only a verified amount counts. Unknown stays unknown — it is never scored as zero.
    { key: 'allowance', label: 'Verified allowance', value: c.allowance_monthly_min != null && ['A1', 'A2'].includes(c.allowance_grade) ? Math.min(1, c.allowance_monthly_min / 1500) : c.allowance_grade === 'A6' ? 0 : null,
      note: c.allowance_monthly_min != null && ['A1', 'A2'].includes(c.allowance_grade) ? `RM${c.allowance_monthly_min}/month (${c.allowance_grade})` : c.allowance_grade === 'A6' ? 'Confirmed unpaid' : 'Not confirmed' },
    { key: 'contact', label: 'Contact accessibility', value: email ? 1 : c.careers_page ? 0.6 : c.general_contact ? 0.4 : 0, note: email ? 'Public email recorded' : c.careers_page ? 'Careers page only' : c.general_contact ? 'Contact form / phone only' : 'No contact recorded' },
    { key: 'opening', label: 'Opening evidence', value: ({ ACTIVE_OPENING: 1, CONFIRMED_PROGRAMME: 0.8, HISTORICAL: 0.4, DIRECT_OUTREACH: 0.3, NOT_ACCEPTING: 0, UNKNOWN: null } as Record<string, number | null>)[c.internship_evidence] ?? null, note: c.internship_evidence.replace(/_/g, ' ').toLowerCase() },
    { key: 'freshness', label: 'Evidence freshness', value: monthsOld == null ? null : monthsOld <= 3 ? 1 : monthsOld <= 12 ? 0.5 : 0.2, note: c.last_verified ? `Checked ${c.last_verified}` : 'Never checked' },
  ]
}

export function compare(list: CompareInput[], priority: Priority = 'balanced', today = new Date()): CompareResult {
  if (list.length < 2 || list.length > 4) throw new Error('Compare between 2 and 4 employers.')
  const w = WEIGHTS[priority]
  const scored: Scored[] = list.map((c) => {
    const criteria = criteriaFor(c, today)
    let num = 0, den = 0, known = 0
    for (const k of criteria) { const wt = w[k.key]; if (!wt) continue; if (k.value == null) continue; num += wt * k.value; den += wt; known++ }
    const needed = Object.keys(w).length
    const primary = Object.keys(w).sort((a, b) => w[b] - w[a])[0]
    const primaryKnown = criteria.find((k) => k.key === primary)?.value != null   // the chosen priority itself must be evidenced
    // Require at least half the weighted criteria to be known, else the score is withheld.
    return { company_id: c.company_id, name: c.name, score: primaryKnown && known >= Math.ceil(needed / 2) && den > 0 ? Math.round((num / den) * 20) * 5 : null, known, criteria }
  })
  const ranked = scored.filter((s) => s.score != null).sort((a, b) => b.score! - a.score!)
  if (ranked.length < 2) return { scored, winnerId: null, reason: 'Not enough recorded evidence to compare these employers on this priority.' }
  if (ranked[0].score! - ranked[1].score! < 10) return { scored, winnerId: null, reason: 'These employers are too close on this priority for the recorded evidence to separate them.' }
  return { scored, winnerId: ranked[0].company_id, reason: `${ranked[0].name} matches this priority best on recorded evidence. This is not a prediction of hiring success.` }
}
