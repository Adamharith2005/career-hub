// Exports every employer that is not yet a verified office, with what is known, what is missing and what looks wrong, for the next research pass.
// Reads only data/catalog.json (no student profiles). Usage: node scripts/run-debug.mjs scripts/export-location-research.ts [outDir]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCatalog, type CatalogCompany } from '../core/viewer/catalog.ts'
import { csvCell, parseCsv } from '../core/viewer/contacts.ts'
import { PLACEMENT_LABEL, STATUS_LABEL, isVerifiedLocation, legacyFlags, locationOf, placementStatus } from '../core/viewer/location.ts'
import { normalizeOrgKey } from '../core/research-classify.ts'
const outDir = process.argv[2] ?? path.join(os.homedir(), 'Documents', 'Career Hub', 'exports'); const FILE = 'CAREER_HUB_LOCATION_RESEARCH_REMAINING.csv'
const cat = readCatalog('data/catalog.json'); if (!cat) throw new Error('data/catalog.json not found')
const all = cat.companies, rem = all.filter((c) => !isVerifiedLocation(locationOf(c).physical_office_status))
const CORE_CS = new Set(['SOFTWARE', 'FULL_STACK', 'AI_ML', 'DATA_SCIENCE', 'DATA_ENGINEERING', 'ANALYTICS', 'CYBERSECURITY', 'CLOUD', 'DEVOPS'])
const SUPPORT_CS = new Set(['NETWORKING', 'IT_INFRA', 'INFO_SYSTEMS', 'SYSADMIN'])
const host = (u: string | null | undefined) => (u ?? '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[/?#].*$/, '')
const core = (c: CatalogCompany) => normalizeOrgKey(c.name.replace(/\s*\(.*$/, '').replace(/\s*[—–-]\s.*$/, ''))
// ---- duplicates: same site, same legal entity or the same core name; plus a group-structure note for known parent/subsidiary families
const sig = (c: CatalogCompany) => [host(c.website), normalizeOrgKey((c.legalEntity ?? '').replace(/\s*\/.*$/, '')), core(c)]
const dupOf = new Map<string, string[]>()
for (const a of all) for (const b of all) {
  if (a.id >= b.id) continue; const [ha, la, na] = sig(a), [hb, lb, nb] = sig(b)
  const sameHost = ha && ha === hb && !/linkedin|facebook/.test(ha), sameLegal = la && la === lb, sameName = na && na === nb
  const toks = (s: string) => new Set(s.split(' ').filter((t) => t.length > 3)); const ta = toks(na), tb = toks(nb); const ov = [...ta].filter((t) => tb.has(t)).length
  const likeName = ta.size > 0 && tb.size > 0 && ov / Math.min(ta.size, tb.size) >= 0.75 && ov >= 2
  if (sameLegal || sameName || (sameHost && likeName) || likeName && (ha === hb)) { for (const [x, y] of [[a, b], [b, a]] as const) dupOf.set(x.id, [...(dupOf.get(x.id) ?? []), `${y.id} ${y.name.slice(0, 40)}`]) }
}
const FAMILY: [RegExp, string][] = [
  [/\bTM\b|telekom|tmrnd|vads|unifi|webe/i, 'Telekom Malaysia group (TM, TM R&D, TM One/VADS, Unifi/Webe): several records may be one employer or subsidiaries of one'],
  [/futurise|cyberview/i, 'Futurise is Cyberview’s innovation arm: one organisation family'],
  [/mydigital|kementerian digital|jabatan digital/i, 'Ministry of Digital family (Kementerian Digital, MyDIGITAL Corporation, JDN): check for overlap'],
  [/jabatan perdana menteri|\(JPM|BHEUU|\bBPH\b|\bMKN\b|NACSA/i, 'Prime Minister’s Department family: bureaus and agencies may not recruit separately'],
  [/\bIOI\b/i, 'IOI group (IOI Corporation, IOI Properties, IOI City Mall): related companies sharing one address'],
  [/petronas|setel/i, 'PETRONAS group (PETRONAS Digital, Setel): related companies'],
  [/celcomdigi|\bwebe\b/i, 'Telco group record'],
]
// ---- the checks
const HQ_RES = [/\((?:primary )?hq:\s*([^)]+)\)/i, /primary hq(?: is)?(?: at| in)?:?\s*([^).;]+)/i, /(?:corporate )?hq (?:is |are )?(?:in|at|located (?:in|at)) ([^.;]+)/i, /headquartered (?:in|at) ([^.;,]+)/i]
const LOCAL_HQ = /putrajaya|cyberjaya|presint|precinct|kompleks|perdana|picc|ioi|menara prisma|wisma|blok|aras|level|via official/i
const hqKnown = (c: CatalogCompany): string => { const v = hqRaw(c); return v && !LOCAL_HQ.test(v) ? v : '' }   // only a stated headquarters outside the target area counts
const hqRaw = (c: CatalogCompany): string => { const text = [...c.offices.map((o) => o.address), locationOf(c).location_review_notes ?? '', c.notes ?? ''].join(' | '); for (const re of HQ_RES) { const m = re.exec(text); if (m) return m[1].trim().replace(/\s+/g, ' ').slice(0, 100) } return '' }
const OUTSIDE_RE = /(official|company)[^.]{0,60}(lists?|lists only|confirm)[^.]{0,80}(subang|penang|johor|bukit jelutong|shah alam|kuala lumpur|petaling jaya)/i
const SUBUNIT_RE = /\b(unit|division|bahagian|ground station|digital ecosystem|campus|cluster|hub|project delivery|public sector (support|digital|delivery)|spin-?off|operations|pejabat (wilayah|putrajaya)|wilayah putrajaya|regional office|\bipd\b)\b/i
const FRAGMENT = /(&|\/).*(hotel|le m[eé]ridien)|palm garden|nusantara digital|putra science park|spin-off/i
function evidenceClass(c: CatalogCompany) {
  const l = locationOf(c), chk = l.office_source_check, notes = `${l.location_review_notes ?? ''} ${c.notes ?? ''} ${c.uncertainties.join(' ')}`
  if (l.physical_office_status === 'DISPUTED_LOCATION') return OUTSIDE_RE.test(notes) ? 'POSITIVE_OUTSIDE_EVIDENCE' : 'CONFLICTING_EVIDENCE'
  if (chk === 'UNREACHABLE') return 'SOURCE_UNREADABLE'
  if (chk === 'UNSUPPORTED' || chk === 'PARTIAL') return 'SOURCE_READ_BUT_DID_NOT_SUPPORT'
  if (chk === 'ZONE_ONLY') return 'ZONE_ONLY_EVIDENCE'
  if (/^(unverified)/i.test(l.physical_office_status) || l.physical_office_status === 'UNVERIFIED_LOCATION') return 'NO_EVIDENCE_PRIOR_LEAD'
  return 'NO_EVIDENCE_YET'
}
function issues(c: CatalogCompany) {
  const out: [string, string][] = []; const l = locationOf(c), f = legacyFlags(c), name = c.name
  const hq = hqKnown(c), ev = evidenceClass(c)
  if (c.priorLead) out.push(['UNVERIFIED_LEAD', 'came from the earlier "missing leads" list and has never been researched'])
  const d = dupOf.get(c.id); if (d?.length) out.push(['POSSIBLE_DUPLICATE', d.slice(0, 3).join('; ')])
  for (const [re, note] of FAMILY) if (re.test(`${name} ${c.legalEntity ?? ''} ${host(c.website)}`) && !(d?.length)) { out.push(['GROUP_OVERLAP', note]); break }
  if ((c.mergedFrom ?? []).length) out.push(['DUPLICATE_ALREADY_MERGED', (c.mergedFrom ?? []).map((m) => `${m.id} (claimed ${m.city ?? 'unknown'})`).join('; ')])
  if (/\(.+\)/.test(name) && SUBUNIT_RE.test(name) || FRAGMENT.test(name)) out.push(['MAYBE_NOT_STANDALONE', 'the name describes a unit, branch or project site of a larger organisation, or bundles several entities'])
  if (/^(new|prior)-/.test(c.id) && /placeholder|combined|spin-?off|digital ecosystem|ecosystem hub|unit/i.test(`${name} ${l.location_review_notes}`)) out.push(['MAYBE_NOT_GENUINE', 'research notes call it a placeholder, combined or spin-off entry'])
  if (f.includes('MERGED_RECORD_HAD_DIFFERENT_CITY') || f.includes('IOI_ADDRESS_UNDER_PUTRAJAYA_CLAIM') || f.includes('PUTRAJAYA_POSTCODE_WITHOUT_PRECINCT')) out.push(['MAYBE_WRONG_LOCATION', f.filter((x) => /MERGED|IOI_ADDRESS|POSTCODE/.test(x)).join(', ')])
  if (hq && !new RegExp(c.city ?? '^$', 'i').test(hq)) out.push(['HQ_ELSEWHERE', `record states headquarters at ${hq}; local presence is a branch, project site or unproven`])
  if (l.office_type === 'PROJECT_SITE_CLAIM') out.push(['MAYBE_PROJECT_SITE_NOT_OFFICE', 'described as a project or client site; a contract is not an office'])
  if (/obsolete|former(ly)?|renamed|relocat|old address|earlier research location/i.test(`${notes(c)}`)) out.push(['MAYBE_OUTDATED', 'notes mention an obsolete, former, renamed or relocated address'])
  if (/ministry of energy and natural resources|kementerian tenaga dan sumber asli|kementerian sumber asli/i.test(name) || /2018|2019|2020|2021/.test(c.lastVerified ?? '')) out.push(['MAYBE_OUTDATED', 'organisation name or verification date may predate recent restructuring'])
  if (ev === 'SOURCE_UNREADABLE') out.push(['SOURCE_PROBLEM', l.office_source_check_note ?? 'source could not be read'])
  return out
  function notes(x: CatalogCompany) { return `${locationOf(x).location_review_notes ?? ''} ${x.notes ?? ''} ${x.uncertainties.join(' ')} ${x.offices.map((o) => `${o.address} ${o.note ?? ''}`).join(' ')}` }
}
function missingProof(c: CatalogCompany) {
  const l = locationOf(c), m: string[] = [], hq = hqKnown(c)
  if (!l.office_source_url) m.push('no source page found for any office'); else if (!l.office_source_check || l.office_source_check === 'NOT_CHECKED') m.push('source page not read'); else if (l.office_source_check === 'UNREACHABLE') m.push('source page blocked or unreadable')
  else if (l.office_source_check === 'ZONE_ONLY') m.push('source shows the employer in the zone but not the building address'); else if (l.office_source_check === 'PARTIAL' || l.office_source_check === 'UNSUPPORTED') m.push('source page does not tie this address to this employer')
  if (!l.physical_office_address) m.push('no address'); if (hq && l.physical_office_status !== 'OUTSIDE_TARGET_AREA') m.push('whether the local site is an office, a branch or only a project site')
  if (l.physical_office_status === 'DISPUTED_LOCATION') m.push('which of the conflicting locations is right')
  if (placementStatus(l) !== 'VERIFIED_LOCAL' && placementStatus(l) !== 'VERIFIED_ELSEWHERE') m.push('where interns are actually placed')
  return m.join('; ')
}
function positive(c: CatalogCompany) {
  const l = locationOf(c), p: string[] = []
  if (l.office_source_check === 'ZONE_ONLY') p.push(`job or listing page places the employer in ${l.physical_office_zone.toLowerCase().replace(/_/g, ' ')}`)
  if (c.offices.some((o) => o.status === 'VERIFIED')) p.push('earlier research rated an office "verified" (Gemini claim, not confirmed by us)')
  if (l.origin === 'AUDIT_IMPORT' && l.office_source_url) p.push('audit cited an official source (not confirmed to support it)')
  if (placementStatus(l).startsWith('VERIFIED')) p.push(`placement source: ${l.internship_placement_location}`)
  return p.join('; ')
}
function priority(c: CatalogCompany, ev: string): [string, string] {
  const l = locationOf(c), z = l.physical_office_zone, tags = c.tech, hi = /^highly/i.test(c.relevance ?? ''), mod = /^moderately/i.test(c.relevance ?? '')
  const coreCS = tags.some((t) => CORE_CS.has(t)), supCS = tags.some((t) => SUPPORT_CS.has(t)), near = z === 'CYBERJAYA' || z === 'IOI_RESORT_CITY'
  const issue = issues(c).map((x) => x[0])
  const notEmployer = issue.includes('MAYBE_NOT_GENUINE') || issue.includes('MAYBE_NOT_STANDALONE')
  if (near && (hi || coreCS) && coreCS && !notEmployer) return ['P1', `CS employer (${tags.filter((t) => CORE_CS.has(t)).slice(0, 2).join(', ')}) in ${near ? z.toLowerCase().replace(/_/g, ' ') : ''}`]
  if (near && coreCS) return ['P2', 'CS-relevant, Cyberjaya or IOI, but the record may not be a standalone employer']
  if (near && /^prior-/.test(c.id)) return ['P2', 'earlier lead in Cyberjaya or IOI, relevance unknown']
  if (z === 'PUTRAJAYA' && hi && coreCS) return ['P2', 'highly relevant CS employer in Putrajaya']
  if (ev === 'CONFLICTING_EVIDENCE' || ev === 'POSITIVE_OUTSIDE_EVIDENCE') return ['P2', 'conflicting location evidence on a CS-relevant employer']
  if (near && (mod || supCS)) return ['P3', 'supporting-IT employer in Cyberjaya or IOI']
  if (z === 'PUTRAJAYA' && (hi || mod) && (coreCS || supCS)) return ['P3', 'IT work relevant in Putrajaya']
  return ['P4', 'low CS relevance or no clear technical role']
}
/** What this research pass found out by reading official pages and searching. Public sources only; nothing here promotes a record. */
const FOUND: Record<string, string> = {
  'cj-009': 'IOI Properties\u2019 tenant page (ioiproperties.com.my/ioi-resort-city-tenant-reward-program) says AIA Shared Services staff work at NeoCyber, Cyberjaya, while AIA\u2019s Workday posting says IOI City Tower 1. Conflict unresolved; needs AIA\u2019s own contact page or the SSM registered address.',
  'cy-004': 'dell.com/en-my/lp/privacy-center-support gives a postal address for Dell Global Business Center Sdn Bhd, 2900 Persiaran APEC, 63000 Cyberjaya. That is a mailing address for a different legal entity than "Dell Technologies Malaysia"; no office or locations page found.',
  'cy-038': 'Only directories (JobStreet, EMIS) give Tamarind Square; ixtelecom.net/contact shows no address. Unit D1-04-10 for IX Telecom versus D1-05-10 for IX Global Services. A job listing places an engineering intern role in Cyberjaya.',
  'new-10': 'ioiproperties.com.my news says IOI City Towers 1 and 2 are the head offices of IOI Properties and IOI Corp. No single IOI Properties page ties the company to the Level 29 address (IOI Corporation itself is verified there). Related IOI group records share the address.',
  'pj-003': 'The cited source is an image-only auction-flyer PDF. lppsa.gov.my opens but no address page was found.',
  'pj-007': 'Audit notes say official HeiTech pages show its HQ in Bukit Jelutong, Shah Alam. A Putrajaya project office is not an office.',
  'pj-008': 'moh.gov.my refuses automated access (403). A 2023 MOH bulletin lists Kompleks E, 62590 Putrajaya, but its host would not connect.',
  'pj-014': 'The iyres.gov.my location page labels the address "Kementerian Belia dan Sukan" (Menara KBS). That is the ministry\u2019s address, not IYRES\u2019s own; IYRES\u2019s own contact page was not found.',
  'pj-016': 'The official Mesiniaga contact page lists Subang Jaya (HQ), Penang and Johor only. That is not proof there is no Putrajaya site, only that none is listed.',
  'pj-017': 'nadma.gov.my refuses connections. Only a Wikipedia mirror gives Blok D5, Kompleks D.',
  'pj-022': 'ekonomi.gov.my refuses connections. Third-party pages show Menara Prisma, No. 26, Persiaran Perdana, Presint 3, but no official page could be read.',
  'pj-039': 'Corporate HQ is in Petaling Jaya. The Putrajaya "Public Sector Delivery Unit" carries client or project-site wording and cites only a generic careers page.',
  'pj-065': 'hilton.com returns 403 to automated access.',
  'pj-070': 'The cited page shows no Putrajaya address. A 2022 Bank Islam notice mentions a Putrajaya branch at Suasana PjH that may have closed.',
  'new-03': 'HQ is KL Sentral / Menara 3 PETRONAS. "Cyberjaya Digital & Tech Ecosystem Hub" is a cluster description with no street, building or suite.',
  'new-05': 'HQ is PETRONAS Twin Towers. The "Cyberjaya Data Centre & Digital Operations Presence" has no street or building proof.',
  'new-15': 'Only the ioicitymall.com.my homepage and a parent careers page are recorded.',
  'cy-005': 'tmrnd.com.my now shows TM R&D at the TM Innovation Center, Cyberjaya (verified). The TM, TM One/VADS and Unifi/Webe records are related TM-group entities.',
}
const SORT = ['P1', 'P2', 'P3', 'P4']
const rank = (c: CatalogCompany) => (c.tech.some((t) => CORE_CS.has(t)) ? 0 : 1) + (/^highly/i.test(c.relevance ?? '') ? 0 : 1)
const HEAD = ['priority', 'priority_reason', 'company_id', 'atlas_id', 'historical_ids', 'company_name', 'legal_entity', 'employer_type', 'cs_relevance', 'technical_areas', 'claimed_city', 'current_location_status', 'current_zone', 'evidence_class', 'known_hq_if_stated', 'claimed_office_address', 'all_recorded_addresses', 'office_source_url', 'office_source_check', 'office_source_check_note', 'positive_evidence_so_far', 'missing_proof', 'disputes_and_flags', 'data_quality_issues', 'data_quality_notes', 'placement_location_claimed', 'placement_source_url', 'placement_status', 'website', 'internship_evidence', 'other_source_urls', 'research_notes_this_pass', 'next_research_step']
const rows = rem.map((c) => {
  const l = locationOf(c), ev = evidenceClass(c), is = issues(c), [pri, why] = priority(c, ev)
  const urls = [...new Set([c.website, c.internship.applicationUrl, c.contacts.careersUrl, ...c.sources.map((s) => s.url)].filter((u): u is string => !!u && u !== l.office_source_url))]
  const step = ev === 'SOURCE_UNREADABLE' ? 'Find an alternative official page (contact, locations, annual report) or read the blocked page in a browser' : ev === 'ZONE_ONLY_EVIDENCE' ? 'Find the official contact or locations page that gives the building address' : ev === 'POSITIVE_OUTSIDE_EVIDENCE' || ev === 'CONFLICTING_EVIDENCE' ? 'Settle the conflict: find a current official page for the local office, or record the employer as outside the area' : ev === 'SOURCE_READ_BUT_DID_NOT_SUPPORT' ? 'Find a page that names this employer beside the address' : 'Find the official contact, locations or "our offices" page naming the employer and its address'
  return [pri, why, c.id, c.leadId ?? '', (c.mergedFrom ?? []).map((m) => `${m.id}${m.leadId ? `/${m.leadId}` : ''}`).join('; '), c.name, c.legalEntity ?? '', c.categoryLabel ?? c.sector, c.relevance ?? '', c.tech.join(', '), c.city ?? '', STATUS_LABEL[l.physical_office_status], l.physical_office_zone, ev, hqKnown(c), l.physical_office_address ?? '', c.offices.map((o) => `[${o.status}] ${o.address}`).join(' || '), l.office_source_url ?? '', l.office_source_check ?? '', l.office_source_check_note ?? '', positive(c), missingProof(c), legacyFlags(c).join('; '), is.map((x) => x[0]).join('; '), is.map((x) => `${x[0]}: ${x[1]}`).join(' | '), l.internship_placement_location ?? '', l.internship_placement_source_url ?? '', PLACEMENT_LABEL[placementStatus(l)], c.website ?? '', c.internship.evidence, urls.slice(0, 5).join(' | '), FOUND[c.id] ?? '', step]
})
rows.sort((a, b) => SORT.indexOf(a[0] as string) - SORT.indexOf(b[0] as string) || rank(rem.find((c) => c.id === a[2])!) - rank(rem.find((c) => c.id === b[2])!) || String(a[2]).localeCompare(String(b[2])))
fs.mkdirSync(outDir, { recursive: true }); const out = path.join(outDir, FILE)
fs.writeFileSync(out, [HEAD, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n')
// ---- validation
const back = parseCsv(fs.readFileSync(out, 'utf8')); const ids = back.map((r) => r.company_id); const unique = new Set(ids)
const expected = new Set(rem.map((c) => c.id)); const verifiedIds = new Set(all.filter((c) => isVerifiedLocation(locationOf(c).physical_office_status)).map((c) => c.id))
if (back.length !== rem.length || unique.size !== rem.length || ids.some((i) => !expected.has(i)) || ids.some((i) => verifiedIds.has(i))) throw new Error('export validation failed')
console.log(`Catalogue ${all.length} = verified ${verifiedIds.size} + remaining ${rem.length}. CSV rows ${back.length}, unique ids ${unique.size}, none verified. ${HEAD.length} columns.`)
const tally = (k: string) => { const t: Record<string, number> = {}; for (const r of back) for (const v of (r[k] || '(none)').split('; ')) t[v] = (t[v] ?? 0) + 1; return t }
console.log('Priority:', tally('priority')); console.log('Evidence class:', tally('evidence_class')); console.log('Data quality:', tally('data_quality_issues')); console.log('Placement:', tally('placement_status')); console.log('Wrote', out)
