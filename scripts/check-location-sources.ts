// Reads the source page behind every verified-office claim (and every placement claim) and classifies what it actually shows.
//   SUPPORTED   direct address evidence: the claimed address is on the page AND tied to the employer (the employer is named beside it, or the page is the employer's own).
//   ZONE_ONLY   the employer is shown in the zone (for example a job listing) but the building is not.
//   PARTIAL     address words appear, but nothing ties them to the employer (a different organisation's address, a sidebar, an unrelated section).
//   UNSUPPORTED the page does not show the zone.
//   UNREACHABLE blocked, missing, unreadable. Access restrictions are respected, never bypassed.
// Fetch order: curl, then Node fetch, then headless Chrome for pages that need JavaScript. PDFs are read with pdfjs.
// Usage: node scripts/run-debug.mjs scripts/check-location-sources.ts [auditCsv] [outJson] [--only id,id]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readCatalog } from '../core/viewer/catalog.ts'
import { parseCsv } from '../core/viewer/contacts.ts'
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== process.argv[process.argv.indexOf('--only') + 1])
const file = argv[0] ?? path.join(os.homedir(), 'Downloads', 'CAREER_HUB_LOCATION_AUDIT_VERIFIED.csv')
const out = argv[1] ?? 'data/location-source-checks.json'
const only = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null
const cat = readCatalog('data/catalog.json')!; const byId = new Map(cat.companies.map((c) => [c.id, c]))
const all = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
const GENERIC = new Set('berhad sdn bhd malaysia malaysian jabatan kementerian agensi institut institute department ministry national negara bangunan blok block aras level lot kompleks complex pusat persiaran jalan lorong presint putrajaya cyberjaya selangor wilayah persekutuan federal government kerajaan the and for of dan cyber darul ehsan 63000 group services service holdings international technologies technology'.split(' '))
const squash = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
const toks = (s: string) => [...new Set(squash(s).split(' ').filter((t) => t.length >= 3 && !GENERIC.has(t)))]
const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, '')
type Page = { status: number; text: string; title: string; type: string; via: string; error?: string }
const clean = (html: string) => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
const titleOf = (html: string) => clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()
async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs'); const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise
  const parts: string[] = []; for (let i = 1; i <= Math.min(doc.numPages, 60); i++) { const p = await doc.getPage(i); parts.push((await p.getTextContent()).items.map((x: any) => x.str).join(' ')) }
  return parts.join(' ').replace(/\s+/g, ' ')
}
async function viaCurl(url: string): Promise<Page> {
  const tmp = path.join(os.tmpdir(), `chk-${process.pid}.bin`)
  try {
    const meta = execFileSync('curl', ['-sS', '-L', '-m', '30', '--max-filesize', '12000000', '-A', 'Mozilla/5.0 (compatible; CareerHubSourceCheck)', '-o', tmp, '-w', '%{http_code}|%{content_type}', url], { timeout: 45000, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    const [code, type = ''] = meta.split('|'); const buf = fs.readFileSync(tmp)
    if (/pdf/i.test(type) || buf.subarray(0, 4).toString() === '%PDF') return { status: Number(code), text: await pdfText(buf).catch(() => ''), title: '', type: 'pdf', via: 'pdf' }
    const html = buf.toString('utf8'); return { status: Number(code), text: clean(html), title: titleOf(html), type, via: 'curl' }
  } catch (e) { return { status: 0, text: '', title: '', type: '', via: 'curl', error: String((e as Error).message ?? e).split('\n')[0].slice(0, 100) } } finally { fs.rmSync(tmp, { force: true }) }
}
let browser: any = null
async function viaChrome(url: string): Promise<Page> {
  try {
    const { chromium } = await import('playwright'); browser ??= await chromium.launch({ channel: 'chrome', headless: true })
    const p = await browser.newPage(); try {
      const r = await p.goto(url, { timeout: 35000, waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500)
      return { status: r?.status() ?? 0, text: (await p.innerText('body')).replace(/\s+/g, ' '), title: await p.title(), type: 'text/html', via: 'chrome' }
    } finally { await p.close() }
  } catch (e) { return { status: 0, text: '', title: '', type: '', via: 'chrome', error: String((e as Error).message ?? e).split('\n')[0].slice(0, 100) } }
}
async function get(url: string): Promise<Page> {
  let a = await viaCurl(url); if (!a.status) a = await viaCurl(url)   // one retry for a dropped connection
  if (a.status === 200 && a.text.length >= 400) return a
  if (a.status === 403 || a.status === 401) return a                         // an explicit refusal is respected
  const b = await viaChrome(url); return b.status === 200 && b.text.length > a.text.length ? b : (a.status ? a : b)
}
function judge(g: Page, name: string, legal: string | null, website: string | null, zone: string, address: string, url: string) {
  const hay = squash(`${g.title} ${g.text}`); const nameToks = toks(`${name.replace(/\s*\(.*$/, '')} ${legal ?? ''}`)
  const words = squash(address).split(' ').filter(Boolean), bigrams = words.slice(1).map((w, i) => `${words[i]} ${w}`).filter((b) => !/^(cyberjaya|putrajaya) /.test(b))
  const addrToks = toks(address)
  // the densest 500-character stretch of the page that repeats the claimed address
  const hits: number[] = []; for (const b of bigrams) { let i = -1; while ((i = hay.indexOf(b, i + 1)) >= 0) hits.push(i) }; hits.sort((x, y) => x - y)
  let best = -1, bestN = 0; for (const h of hits) { const n = hits.filter((x) => x >= h && x < h + 500).length; if (n > bestN) { best = h; bestN = n } }
  const win = best >= 0 ? hay.slice(Math.max(0, best - 400), best + 900) : ''
  const addrHits = addrToks.filter((t) => hay.includes(t)).length, phrases = new Set(hits.map((h) => hay.slice(h, h + 12))).size
  const titleHay = squash(g.title), host = hostOf(url).replace(/[^a-z0-9]/g, '')
  const THIRD_SITES = new Set('hiredly jobstreet indeed glassdoor linkedin moovit emis dnb zoominfo rocketreach cbinsights craft sgpgrid bizapedia propertyguru iproperty wikipedia wikiwand facebook careerconnect peeringdb yellowpages mapquest tripadvisor booking agoda lookup opencorporates companieslist malaysiakini thestar theedgemarkets technode prnewswire businesstoday bernama pikom usm'.split(' '))
  const registrable = hostOf(url).split('.').filter((l) => !['com', 'net', 'org', 'my', 'co', 'uk', 'gov', 'edu', 'io', 'cn', 'sg', 'global'].includes(l)).pop() ?? ''
  const hostOwn = (!!website && hostOf(url).endsWith(hostOf(website))) || nameToks.some((t) => host.includes(t))
  // a university's career-portal page about an employer is the university talking about it, not the employer
  const THIRD = !hostOwn && (THIRD_SITES.has(registrable) || ['careerconnect', 'careers-portal'].includes(hostOf(url).split('.')[0]))
  const own = !THIRD && (hostOwn || (nameToks.length > 0 && nameToks.filter((t) => titleHay.includes(t)).length >= Math.ceil(nameToks.length / 2)))
  const near = win !== '' && nameToks.some((t) => win.includes(t))
  const zoneRe = zone === 'OUTSIDE' || zone === 'UNKNOWN' ? /[\s\S]/ : zone === 'CYBERJAYA' ? /cyberjaya/ : zone === 'IOI_RESORT_CITY' ? /ioi|sepang/ : /putrajaya/
  const named = nameToks.some((t) => hay.includes(t)); const zoneAt = hay.search(zoneRe)
  const zoneNearEmployer = zoneAt >= 0 && (own || nameToks.some((t) => { const i = hay.indexOf(t); return i >= 0 && Math.abs(i - zoneAt) < 1500 }))
  // a real address block carries a postcode or street number; a navigation list of building names does not
  const looksLikeAddress = best >= 0 && /\b6\d{4}\b|\bno \d+\b|\b(presint|precinct) \d+\b/.test(hay.slice(best, best + 700))
  // the words just before the address say whose address it is; a different organisation's label means the match is unrelated
  const prefix = best >= 0 ? hay.slice(Math.max(0, best - 140), best) : ''
  const otherOrg = /(kementerian|jabatan|agensi|institut|suruhanjaya|lembaga|perbadanan|ministry|department|agency|institute|commission|authority)\s+[a-z ]{0,70}$/.test(prefix) && nameToks.filter((t) => prefix.includes(t)).length < Math.max(1, Math.floor(nameToks.length / 3)) && !host.split('.')[0].length
  const labelOther = /(kementerian|jabatan|agensi|institut|suruhanjaya|lembaga|perbadanan|ministry|department|agency|institute|commission|authority)\s+[a-z ]{0,70}$/.test(prefix) && nameToks.length > 1 && nameToks.filter((t) => prefix.includes(t)).length < Math.max(1, Math.floor(nameToks.length / 3))
  void otherOrg
  if (process.env.CHK_DEBUG) console.log('   DEBUG', JSON.stringify({ nameToks, prefix, looksLikeAddress, labelOther, bestN }))
  const direct = bestN >= 2 && addrToks.length >= 2 && addrHits / addrToks.length >= 0.5 && looksLikeAddress && !labelOther
  // directories, job boards, review sites and encyclopaedias repeat addresses without being the employer's own statement of where it works
  const ok = g.status === 200 && g.text.length > 100
  let verdict: string, why: string
  if (!ok) { verdict = 'UNREACHABLE'; why = g.type === 'pdf' ? 'PDF had no readable text' : `HTTP ${g.status || 'no response'}${g.error ? ` (${g.error.slice(0, 50)})` : ''}` }
  else if (THIRD && !own && (direct || bestN >= 2)) { verdict = 'PARTIAL'; why = 'third-party directory, job board or news site, not the employer\u2019s own page' }
  else if (direct && (near || own)) { verdict = 'SUPPORTED'; why = `direct address evidence: ${bestN} address phrases ${near ? 'beside the employer name' : "on the employer's own page"}` }
  else if (bestN >= 2 && addrHits / Math.max(1, addrToks.length) >= 0.5 && (labelOther || !looksLikeAddress)) { verdict = 'PARTIAL'; why = labelOther ? 'the address is labelled for a different organisation' : 'address words appear in a list or menu, not an address block' }
  else if (direct) { verdict = 'PARTIAL'; why = 'address words appear but nothing ties them to this employer' }
  else if (zoneRe.test(hay) && named && zoneNearEmployer) { verdict = 'ZONE_ONLY'; why = 'shows the employer in this zone, not the building address' }
  else if (zoneRe.test(hay)) { verdict = 'PARTIAL'; why = named ? 'zone and employer both appear but are not connected' : 'zone appears but the employer is not named' }
  else { verdict = 'UNSUPPORTED'; why = 'the page does not show the zone' }
  if (g.via === 'pdf' && verdict !== 'UNREACHABLE') why += ' (source is a PDF document, not a contact page)'
  return { verdict, why, via: g.via, status: g.status, title: g.title.slice(0, 90), evidence: win ? win.slice(300, 700) : '' }
}
const results: Record<string, any> = {}; const today = new Date().toISOString().slice(0, 10)
const placementZone = (t: string) => (/ioi/i.test(t) ? 'IOI_RESORT_CITY' : /cyberjaya|cyber\s*\d/i.test(t) ? 'CYBERJAYA' : 'PUTRAJAYA')
for (const r of all) {
  if (only && !only.has(r.company_id)) continue
  const c = byId.get(r.company_id); if (!c) continue; const o: any = { checkedOn: today }
  if (/^(VERIFIED|OUTSIDE)/.test(r.physical_office_status) && /^https?:/.test(r.office_source_url)) { const j = judge(await get(r.office_source_url), c.name, c.legalEntity, c.website, r.physical_office_zone, r.physical_office_address, r.office_source_url); o.office = j.verdict; o.officeNote = j.why; o.via = j.via; o.title = j.title; o.evidence = j.evidence }
  const pl = r.internship_placement_location, pu = r.internship_placement_source_url
  if (pl && !/^unknown/i.test(pl) && /^https?:/.test(pu)) { const j = judge(await get(pu), c.name, c.legalEntity, c.website, placementZone(pl), pl, pu); o.placement = j.verdict; o.placementNote = j.why }
  if (o.office || o.placement) { results[r.company_id] = o; console.log(r.company_id.padEnd(8), (o.office ?? '-').padEnd(11), (o.placement ?? '-').padEnd(11), o.via ?? '', (o.officeNote ?? o.placementNote).slice(0, 80)) }
}
await browser?.close()
// page excerpts can contain named staff and personal contact details: they are kept only when asked for, never in the committed file
if (!process.env.CHK_KEEP_EVIDENCE) for (const v of Object.values(results)) delete v.evidence
fs.writeFileSync(out, JSON.stringify({ checkedOn: today, results }, null, 1)); console.log('Wrote', out)
