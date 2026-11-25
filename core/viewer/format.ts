/** Plain-text formatters for the copy buttons. Only fields that exist are emitted; nothing is invented. */
import type { CatalogCompany } from './catalog.ts'
import { TECH_LABEL } from './catalog.ts'
import { contactSummary, VERIFICATION_LABEL } from './contacts.ts'

export const ALLOWANCE_LABEL: Record<string, string> = {
  CONFIRMED_PAID: 'Confirmed paid', HISTORICAL: 'Historical allowance', ESTIMATED: 'Estimated / policy only', UNKNOWN: 'Not confirmed', CONFIRMED_UNPAID: 'Confirmed unpaid',
}
export const EVIDENCE_LABEL: Record<string, string> = {
  ACTIVE_OPENING: 'Advertised opening', CONFIRMED_PROGRAMME: 'Confirmed internship programme', REPORTED_PROGRAMME: 'Programme reported in research (not independently checked)', HISTORICAL: 'Historical evidence only',
  DIRECT_OUTREACH: 'Unadvertised: cold-outreach candidate', NOT_ACCEPTING: 'Not accepting interns', UNKNOWN: 'Unknown',
}

const line = (label: string, v: string | null | undefined) => (v && v.trim() ? `${label}: ${v.trim()}` : null)

export function allowanceHeadline(c: CatalogCompany): string {
  const a = c.allowance
  if (a.status === 'CONFIRMED_UNPAID') return 'No allowance (official page)'
  if (a.monthlyMin != null && (a.status === 'CONFIRMED_PAID' || a.status === 'HISTORICAL' || a.status === 'ESTIMATED'))
    return `RM${a.monthlyMin}${a.monthlyMax && a.monthlyMax !== a.monthlyMin ? `–${a.monthlyMax}` : ''}/month · ${ALLOWANCE_LABEL[a.status].toLowerCase()}`
  if (a.policyRef) return 'Government policy may apply · not confirmed'
  return 'Allowance not confirmed'
}

export function allowanceText(c: CatalogCompany): string {
  const a = c.allowance
  return [
    `Allowance (${c.name}): ${allowanceHeadline(c)}`,
    a.policyRef ? 'Basis: general government policy (JPA, RM5 per hour, up to 8 h/day and 90 paid days). This is not a confirmation of what this organisation pays.' : null,
    a.claimText && a.status !== 'CONFIRMED_PAID' ? `Unverified claim in research file: ${a.claimText}` : null,
    line('Conditions', a.conditions), line('Other benefits', a.benefits), line('Source', a.sourceUrl), line('Source date', a.sourceDate),
  ].filter(Boolean).join('\n')
}

export function contactText(c: CatalogCompany): string {
  const cs = contactSummary(c); const rows: string[] = []
  for (const r of cs.routes) {
    if (r.verification === 'INVALID') continue
    const tag = VERIFICATION_LABEL[r.verification]
    rows.push(`${r.kind === 'EMAIL' ? (r.tier === 'E4' ? 'General email' : 'Recruitment email') : r.kind === 'PORTAL' ? (r.tier === 'E3' ? 'Careers portal' : 'Contact page') : 'Phone or form'}: ${r.value} (${tag})`)
  }
  const k = c.contacts; const extra = [line('LinkedIn', k.linkedin), line('Website', c.website)].filter(Boolean) as string[]
  return [c.name, ...(rows.length || extra.length ? [...rows, ...extra] : ['No verified public contact details recorded.'])].join('\n')
}

export function applicationText(c: CatalogCompany): string {
  const i = c.internship
  return [
    `How to apply (${c.name})`,
    line('Suggested method', i.method), line('Application page', i.applicationUrl), line('Required documents', i.docs),
    i.deadline && !/^rolling$/i.test(i.deadline) ? line('Deadline (as researched)', i.deadline) : null,
    `Internship evidence: ${EVIDENCE_LABEL[i.evidence]}`,
  ].filter(Boolean).join('\n')
}

export function companyDetailsText(c: CatalogCompany): string {
  const office = c.offices[0]
  return [
    c.name, c.legalEntity && c.legalEntity !== c.name ? line('Legal entity', c.legalEntity) : null,
    line('Location', c.city), `Sector: ${c.sector === 'GOVERNMENT' ? 'Government / public sector' : c.sector === 'NON_GOVERNMENT' ? 'Non-government' : 'Unclassified'}`,
    line('Category', c.categoryLabel), line('Industry', c.industry), line('Website', c.website),
    office ? `Address: ${office.address}${office.status !== 'VERIFIED' ? ' (not verified)' : ''}` : null,
    c.tech.length ? `Relevant technical areas: ${c.tech.map((t) => TECH_LABEL[t]).join(', ')}` : null,
    c.roles.length ? `Possible roles: ${c.roles.join(', ')}` : null,
    '', allowanceText(c), '', applicationText(c), '', contactText(c).split('\n').slice(1).join('\n'),
  ].filter((x) => x !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
