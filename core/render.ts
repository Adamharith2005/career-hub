import PDFDocument from 'pdfkit'
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, TabStopType, TextRun,
} from 'docx'
import { extractPdf } from './cv.ts'
import type { LetterAST, ResumeAST } from './resume.ts'

const W = 595.28, H = 841.89
const M = { l: 44, r: 44, t: 40, b: 40 }
const CW = W - M.l - M.r
const INK = '#111111', SOFT = '#3a3a3a', LINK = '#1d3a8a'

/** Standard PDF fonts are WinAnsi: keep text selectable by mapping unsupported glyphs to safe equivalents. */
export function winAnsi(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[   ]/g, ' ')
    .replace(/−/g, '-').replace(/[→➔]/g, '->')
    .replace(/[^\u0000-ÿ–—•]/g, (c) => c.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\u0000-ÿ]/g, '?'))
}

export interface PdfResult { buffer: Buffer; pages: number; fontSize: number }

function make(title: string, author: string) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: M.t, bottom: M.b, left: M.l, right: M.r }, bufferPages: true, info: { Title: winAnsi(title), Author: winAnsi(author), Creator: 'Career Hub' } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))))
  return { doc, done }
}

function needSpace(doc: PDFKit.PDFDocument, h: number) { if (doc.y + h > H - M.b) doc.addPage() }

function inlineLinks(doc: PDFKit.PDFDocument, segs: { text: string; url?: string }[], size: number) {
  doc.font('Helvetica').fontSize(size)
  const sep = '  |  ', sepW = doc.widthOfString(sep)
  const lines: { text: string; url?: string; w: number }[][] = [[]]
  let width = 0
  for (const s of segs) {
    const w = doc.widthOfString(winAnsi(s.text))
    const add = (lines.at(-1)!.length ? sepW : 0) + w
    if (width + add > CW && lines.at(-1)!.length) { lines.push([]); width = 0 }
    width += (lines.at(-1)!.length ? sepW : 0) + w
    lines.at(-1)!.push({ ...s, w })
  }
  for (const ln of lines) {
    const total = ln.reduce((a, s, i) => a + s.w + (i ? sepW : 0), 0)
    let x = M.l + (CW - total) / 2
    const y = doc.y
    ln.forEach((s, i) => {
      if (i) { doc.fillColor(SOFT).text(sep, x, y, { lineBreak: false }); x += sepW }
      doc.fillColor(s.url ? LINK : SOFT).text(winAnsi(s.text), x, y, { lineBreak: false, link: s.url, underline: !!s.url })
      x += s.w
    })
    doc.y = y + size * 1.25
  }
  doc.fillColor(INK)
}

function drawResume(ast: ResumeAST, s: number): Promise<PdfResult> {
  const { doc, done } = make(`Resume - ${ast.header.name}`, ast.header.name)
  const lh = s * 1.22
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(s + 8).text(winAnsi(ast.header.name), M.l, M.t, { width: CW, align: 'center' })
  doc.moveDown(0.15)
  inlineLinks(doc, ast.header.contacts.map((c) => ({ text: c.text, url: c.url })), s - 0.5)
  if (ast.summary) {
    doc.moveDown(0.35).font('Helvetica').fontSize(s).fillColor(INK).text(winAnsi(ast.summary.text), M.l, doc.y, { width: CW, align: 'left' })
  }
  for (const sec of ast.sections) {
    needSpace(doc, lh * 4)
    doc.moveDown(0.55)
    doc.font('Helvetica-Bold').fontSize(s + 1).fillColor(INK).text(winAnsi(sec.title), M.l, doc.y, { width: CW })
    const ry = doc.y + 1
    doc.moveTo(M.l, ry).lineTo(W - M.r, ry).lineWidth(0.6).strokeColor('#777777').stroke()
    doc.y = ry + 3
    for (const g of sec.skillGroups ?? []) {
      needSpace(doc, lh * 2)
      doc.font('Helvetica-Bold').fontSize(s).text(winAnsi(`${g.label}: `), M.l, doc.y, { width: CW, continued: true })
      doc.font('Helvetica').text(winAnsi(g.values.join(', ')))
      doc.moveDown(0.1)
    }
    for (const it of sec.items ?? []) {
      needSpace(doc, lh * 3)
      const y = doc.y
      doc.font('Helvetica-Bold').fontSize(s)
      const dw = it.dates ? doc.widthOfString(winAnsi(it.dates)) + 8 : 0
      doc.text(winAnsi(it.heading), M.l, y, { width: CW - dw })
      const endY = doc.y
      if (it.dates) { doc.font('Helvetica').fontSize(s).text(winAnsi(it.dates), M.l, y, { width: CW, align: 'right' }) }
      doc.y = Math.max(endY, y + lh)
      if (it.subheading) { doc.font('Helvetica-Oblique').fontSize(s - 0.5).fillColor(SOFT).text(winAnsi(it.subheading), M.l, doc.y, { width: CW }); doc.fillColor(INK) }
      for (const b of it.bullets) {
        needSpace(doc, lh * 2)
        const by = doc.y
        doc.font('Helvetica').fontSize(s).text('•', M.l + 5, by, { lineBreak: false })
        doc.text(winAnsi(b.text), M.l + 17, by, { width: CW - 17 })
      }
      doc.moveDown(0.25)
    }
  }
  const range = doc.bufferedPageRange()
  const pages = range.count
  doc.end()
  return done.then((buffer) => ({ buffer, pages, fontSize: s }))
}

/** Tries 10.5 -> 10 -> 9.5pt for a single page; never goes below 9.5pt (natural page break instead). */
export async function renderResumePdf(ast: ResumeAST, opts: { targetPages?: number } = {}): Promise<PdfResult> {
  const target = opts.targetPages ?? 1
  let last: PdfResult | null = null
  for (const s of [10.5, 10, 9.5]) {
    const r = await drawResume(ast, s)
    last = r
    if (r.pages <= target) return r
  }
  return drawResume(ast, 10)   // natural multi-page layout at a comfortable size; QA reports the page count
}

export async function renderLetterPdf(l: LetterAST): Promise<PdfResult> {
  const { doc, done } = make(`Cover letter - ${l.sender.name}`, l.sender.name)
  const s = 10.5
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(winAnsi(l.sender.name), M.l + 10, M.t + 6, { width: CW - 20 })
  doc.font('Helvetica').fontSize(s - 0.5).fillColor(SOFT)
  for (const ln of l.sender.lines) doc.text(winAnsi(ln), { width: CW - 20, link: /^[\w.+-]+@[\w.-]+$/.test(ln) ? `mailto:${ln}` : /^https?:|linkedin|github/i.test(ln) ? (ln.startsWith('http') ? ln : `https://${ln}`) : undefined })
  doc.fillColor(INK).moveDown(1.2).font('Helvetica').fontSize(s).text(winAnsi(l.date))
  doc.moveDown(0.8)
  for (const r of l.recipient) doc.text(winAnsi(r))
  doc.moveDown(0.9).font('Helvetica-Bold').text(winAnsi(l.subject))
  doc.moveDown(0.8).font('Helvetica').text(winAnsi(l.salutation))
  for (const p of l.paragraphs) { doc.moveDown(0.7).text(winAnsi(p.text), { width: CW - 20, align: 'left', lineGap: 2 }) }
  doc.moveDown(0.9).text(winAnsi(l.closing))
  doc.moveDown(1.6).font('Helvetica-Bold').text(winAnsi(l.signature))
  const pages = doc.bufferedPageRange().count
  doc.end()
  return done.then((buffer) => ({ buffer, pages, fontSize: s }))
}

// ------------------------------------------------------------------ DOCX
const TWIP_W = 11906, TWIP_H = 16838, MARGIN = 900
const TAB = TWIP_W - MARGIN * 2
const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: 'Arial', ...o })

function docxShell(title: string, author: string, children: Paragraph[]) {
  return new Document({
    creator: author, title,
    styles: {
      default: { document: { run: { font: 'Arial', size: 20 } } },
      paragraphStyles: [{
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial', color: '111111' },
        paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '777777', space: 1 } } },
      }],
    },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 340, hanging: 220 } } } }] }] },
    sections: [{ properties: { page: { size: { width: TWIP_W, height: TWIP_H }, margin: { top: 760, bottom: 760, left: MARGIN, right: MARGIN } } }, children }],
  })
}

export async function renderResumeDocx(ast: ResumeAST): Promise<Buffer> {
  const ch: Paragraph[] = []
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(ast.header.name, { bold: true, size: 32 })] }))
  const kids: (TextRun | ExternalHyperlink)[] = []
  ast.header.contacts.forEach((c, i) => {
    if (i) kids.push(run('  |  ', { color: '3a3a3a', size: 19 }))
    kids.push(c.url ? new ExternalHyperlink({ link: c.url, children: [new TextRun({ text: c.text, font: 'Arial', size: 19, color: '1D3A8A', underline: {} })] }) : run(c.text, { size: 19 }))
  })
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: kids }))
  if (ast.summary) ch.push(new Paragraph({ spacing: { before: 60 }, children: [run(ast.summary.text)] }))
  for (const sec of ast.sections) {
    ch.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(sec.title, { bold: true, size: 22 })] }))
    for (const g of sec.skillGroups ?? []) ch.push(new Paragraph({ spacing: { after: 20 }, children: [run(`${g.label}: `, { bold: true }), run(g.values.join(', '))] }))
    for (const it of sec.items ?? []) {
      ch.push(new Paragraph({ keepNext: true, spacing: { before: 60 }, tabStops: [{ type: TabStopType.RIGHT, position: TAB }], children: [run(it.heading, { bold: true }), ...(it.dates ? [run(`\t${it.dates}`)] : [])] }))
      if (it.subheading) ch.push(new Paragraph({ keepNext: it.bullets.length > 0, children: [run(it.subheading, { italics: true, size: 19, color: '3a3a3a' })] }))
      for (const b of it.bullets) ch.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 10 }, children: [run(b.text)] }))
    }
  }
  return Buffer.from(await Packer.toBuffer(docxShell(`Resume - ${ast.header.name}`, ast.header.name, ch)))
}

export async function renderLetterDocx(l: LetterAST): Promise<Buffer> {
  const p = (t: string, o: { bold?: boolean; after?: number } = {}) => new Paragraph({ spacing: { after: o.after ?? 120 }, children: [run(t, { bold: o.bold, size: 21 })] })
  const ch: Paragraph[] = [p(l.sender.name, { bold: true, after: 20 }), ...l.sender.lines.map((x) => p(x, { after: 0 })), p('', { after: 120 }), p(l.date), ...l.recipient.map((r) => p(r, { after: 0 })),
    p('', { after: 80 }), p(l.subject, { bold: true }), p(l.salutation), ...l.paragraphs.map((x) => p(x.text, { after: 160 })), p(l.closing, { after: 480 }), p(l.signature, { bold: true })]
  return Buffer.from(await Packer.toBuffer(docxShell(`Cover letter - ${l.sender.name}`, l.sender.name, ch)))
}

// ------------------------------------------------------------------ QA
export interface QaCheck { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface QaReport { passed: boolean; checks: QaCheck[]; pages: number; fontSize: number; ranAt: string }

const compact = (s: string) => winAnsi(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const STOP_FIRST = new Set(['cyber', 'tech', 'data', 'global', 'digital', 'jabatan', 'university', 'multimedia', 'malaysia', 'hewlett-packard', 'telekom', 'basis', 'bridge', 'smart', 'open', 'mydigital', 'champion', 'concentrix'])
export function companyAliases(name: string): string[] {
  const out = new Set<string>([name.replace(/\s+(sdn\.?\s*bhd\.?|berhad)\b/i, '').trim()])
  out.add(name.split(/\s\(|\s\/\s/)[0].trim())
  const first = name.split(/[\s/(]/)[0]
  if (first.length >= 5 && !STOP_FIRST.has(first.toLowerCase())) out.add(first)
  return [...out].filter((x) => x.length >= 4)
}

export async function qaExport(a: {
  kind: 'resume' | 'letter'; pdf: Buffer; docx: Buffer; pages: number; fontSize: number; maxPages: number
  name: string; email?: string; headings: string[]; fingerprints: string[]; expectedLinks: string[]
  targetCompany: string; allCompanyNames: string[]; ownText: string
}): Promise<QaReport> {
  const checks: QaCheck[] = []
  const add = (id: string, label: string, ok: boolean | 'warn', detail: string) => checks.push({ id, label, status: ok === 'warn' ? 'warn' : ok ? 'pass' : 'fail', detail })
  const ex = await extractPdf(a.pdf)
  const text = ex.text, ct = compact(text)
  add('selectable', 'Text is selectable', text.replace(/\s/g, '').length > 150, `${text.length} characters extracted from the PDF`)
  add('identity', 'Name and email present', ct.includes(compact(a.name)) && (!a.email || ct.includes(compact(a.email))), `Looked for "${a.name}"${a.email ? ` and ${a.email}` : ''}`)
  // headings in order
  let pos = -1, orderOk = true; const missingH: string[] = []
  for (const h of a.headings) { const i = ct.indexOf(compact(h), pos + 1); if (i < 0) { missingH.push(h); orderOk = false } else pos = i }
  if (a.headings.length) add('headings', 'Standard headings in reading order', orderOk, orderOk ? a.headings.join(' → ') : `Missing or out of order: ${missingH.join(', ')}`)
  const missingF = a.fingerprints.filter((f) => f && !ct.includes(compact(f).slice(0, 40)))
  add('content', 'All content present in the PDF', missingF.length === 0, missingF.length ? `${missingF.length} item(s) not found, e.g. "${missingF[0].slice(0, 50)}"` : `${a.fingerprints.length} items verified`)
  const missingL = a.expectedLinks.filter((u) => !ex.links.some((l) => l.replace(/\/$/, '') === u.replace(/\/$/, '')))
  add('links', 'Links are clickable', missingL.length === 0, missingL.length ? `Missing link annotations: ${missingL.join(', ')}` : `${ex.links.length} link(s) embedded`)
  const blank = (ex.pageTexts ?? []).findIndex((t) => t.replace(/\s/g, '').length < 25)
  add('blank', 'No blank pages', blank < 0, blank < 0 ? `${ex.pages} page(s)` : `Page ${blank + 1} is (almost) empty`)
  add('pages', `Within ${a.maxPages} page${a.maxPages > 1 ? 's' : ''}`, ex.pages <= a.maxPages ? true : 'warn', ex.pages <= a.maxPages ? `${ex.pages} page(s)` : `${ex.pages} pages — trim content for a ${a.maxPages}-page document`)
  add('font', 'Readable font size', a.fontSize >= 9.5, `${a.fontSize}pt body text`)
  // DOCX round trip
  try {
    const mammoth: any = await import('mammoth'); const m = mammoth.default ?? mammoth
    const dt = compact((await m.extractRawText({ buffer: a.docx })).value as string)
    const miss = a.fingerprints.filter((f) => f && !dt.includes(compact(f).slice(0, 40)))
    add('docx', 'Word file opens and matches', dt.includes(compact(a.name)) && miss.length === 0, miss.length ? `${miss.length} item(s) missing from DOCX` : 'DOCX parsed; content matches the document')
  } catch (e: any) { add('docx', 'Word file opens and matches', false, `DOCX could not be parsed: ${e.message}`) }
  // cross-company contamination
  const own = compact(a.ownText), tgt = new Set(companyAliases(a.targetCompany).map(compact))
  const leaks: string[] = []
  for (const n of a.allCompanyNames) {
    const aliases = companyAliases(n)
    if (aliases.some((x) => tgt.has(compact(x)))) continue
    for (const al of aliases) {
      const c = compact(al)
      if (c.length < 4 || own.includes(c) || compact(a.targetCompany).includes(c)) continue
      const re = new RegExp(`(?<![A-Za-z0-9])${al.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i')
      if (re.test(winAnsi(text))) { leaks.push(al); break }
    }
  }
  add('leak', 'No other company named', leaks.length === 0, leaks.length ? `Mentions: ${leaks.join(', ')}` : `Checked against ${a.allCompanyNames.length} known companies`)
  return { passed: !checks.some((c) => c.status === 'fail'), checks, pages: ex.pages, fontSize: a.fontSize, ranAt: new Date().toISOString() }
}
