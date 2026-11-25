/**
 * A4 resume renderer for Career Hub CVs. Single column, standard Helvetica (selectable, ATS-safe), comfortable spacing.
 * Keeps each project/role together across page breaks and keeps a heading with its first entry. No icons, bars or tables.
 */
import PDFDocument from 'pdfkit'
import type { ResumeAST, ResumeItem, ResumeSection } from '../resume.ts'
import { winAnsi } from '../render.ts'

const W = 595.28, H = 841.89
const INK = '#161616', SOFT = '#4a4a4a', RULE = '#8a8a8a', LINK = '#1b3f8f'

export interface CvPdf { buffer: Buffer; pages: number; fontSize: number }

function draw(ast: ResumeAST, s: number, meta: { subject?: string }): Promise<CvPdf> {
  const M = { l: 50, r: 50, t: 44, b: 46 }
  const CW = W - M.l - M.r
  const doc = new PDFDocument({ size: 'A4', margins: { top: M.t, bottom: M.b, left: M.l, right: M.r }, bufferPages: true,
    info: { Title: winAnsi(`${ast.header.name} - Resume`), Author: winAnsi(ast.header.name), Subject: winAnsi(meta.subject ?? 'Resume'), Creator: 'Career Hub' } })
  const chunks: Buffer[] = []; doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))))
  const body = s, small = s - 1, gap = 1.4
  const T = (x: string) => winAnsi(x)
  const room = (h: number) => doc.y + h <= H - M.b
  const ensure = (h: number) => { if (!room(h)) doc.addPage() }
  const hOf = (text: string, font: string, size: number, width: number) => { doc.font(font).fontSize(size); return doc.heightOfString(T(text), { width, lineGap: gap }) }

  // header
  doc.font('Helvetica-Bold').fontSize(21).fillColor(INK).text(T(ast.header.name), M.l, M.t, { width: CW })
  if (ast.header.headline) doc.moveDown(0.1).font('Helvetica').fontSize(body + 0.5).fillColor(SOFT).text(T(ast.header.headline), { width: CW })
  doc.moveDown(0.3)
  // contact line: wrap manually so links stay clickable
  const sep = '   |   '
  doc.font('Helvetica').fontSize(small)
  const parts = ast.header.contacts
  let x = M.l, y = doc.y
  const sepW = doc.widthOfString(sep)
  parts.forEach((c, i) => {
    const w = doc.widthOfString(T(c.text))
    if (i > 0 && x + sepW + w > M.l + CW) { x = M.l; y += small * 1.45 }
    else if (i > 0) { doc.fillColor(RULE).text(sep, x, y, { lineBreak: false }); x += sepW }
    doc.fillColor(c.url ? LINK : SOFT).text(T(c.text), x, y, { lineBreak: false, link: c.url, underline: !!c.url }); x += w
  })
  doc.y = y + small * 1.45; doc.fillColor(INK)

  if (ast.summary) { doc.moveDown(0.55).font('Helvetica').fontSize(body).fillColor(INK).text(T(ast.summary.text), M.l, doc.y, { width: CW, lineGap: gap }) }

  const heading = (title: string) => {
    ensure(body * 5.2)
    doc.moveDown(0.65).font('Helvetica-Bold').fontSize(body + 1.5).fillColor(INK).text(T(title), M.l, doc.y, { width: CW })
    const ry = doc.y + 1.5; doc.moveTo(M.l, ry).lineTo(W - M.r, ry).lineWidth(0.7).strokeColor(RULE).stroke(); doc.y = ry + 5.5
  }
  const itemHeight = (it: ResumeItem, firstOnly = false) => {
    let h = hOf(it.heading, 'Helvetica-Bold', body, CW - 80)
    if (it.subheading) h += hOf(it.subheading, 'Helvetica-Oblique', small, CW)
    const bs = firstOnly ? it.bullets.slice(0, 2) : it.bullets
    for (const b of bs) h += hOf(b.text, 'Helvetica', body, CW - 16) + 1
    return h + 6
  }
  const drawItem = (it: ResumeItem) => {
    const y0 = doc.y
    doc.font('Helvetica-Bold').fontSize(body)
    const dw = it.dates ? doc.widthOfString(T(it.dates)) + 10 : 0
    doc.fillColor(INK).text(T(it.heading), M.l, y0, { width: CW - dw, lineGap: 1 })
    const endY = doc.y
    if (it.dates) doc.font('Helvetica').fontSize(body).fillColor(SOFT).text(T(it.dates), M.l, y0, { width: CW, align: 'right', lineBreak: false })
    doc.y = Math.max(endY, y0 + body * 1.2)
    if (it.subheading) doc.font('Helvetica-Oblique').fontSize(small).fillColor(SOFT).text(T(it.subheading), M.l, doc.y, { width: CW, lineGap: 1 })
    doc.fillColor(INK)
    for (const b of it.bullets) {
      if (/^Technologies:/.test(b.text)) { doc.font('Helvetica-Oblique').fontSize(small).fillColor(SOFT).text(T(b.text), M.l + 15, doc.y + 1, { width: CW - 15, lineGap: 1 }); doc.fillColor(INK); continue }
      const by = doc.y + 1
      doc.font('Helvetica').fontSize(body).text('•', M.l + 4, by, { lineBreak: false, width: 8 })
      doc.text(T(b.text), M.l + 15, by, { width: CW - 15, lineGap: gap })
    }
    doc.y += 3.5
  }
  const drawSection = (sec: ResumeSection) => {
    const first = sec.items?.[0]
    ensure(first ? Math.min(itemHeight(first, true), 80) + body * 4 : body * 6)
    heading(sec.title)
    for (const g of sec.skillGroups ?? []) {
      const labelW = 128
      const txt = g.values.join(', ')
      const h = Math.max(hOf(g.label, 'Helvetica-Bold', body, labelW - 6), hOf(txt, 'Helvetica', body, CW - labelW))
      ensure(h + 2)
      const y0 = doc.y
      doc.font('Helvetica-Bold').fontSize(body).fillColor(INK).text(T(g.label), M.l, y0, { width: labelW - 6, lineGap: gap })
      doc.font('Helvetica').fontSize(body).text(T(txt), M.l + labelW, y0, { width: CW - labelW, lineGap: gap })
      doc.y = y0 + h + 3
    }
    for (const it of sec.items ?? []) { ensure(Math.min(itemHeight(it), 80)); drawItem(it) }
  }
  for (const sec of ast.sections) drawSection(sec)

  const pages = doc.bufferedPageRange().count
  doc.end()
  return done.then((buffer) => ({ buffer, pages, fontSize: s }))
}

/** Tries 10.5pt, then 10pt, to fit the target page count. Never goes below 10pt; a longer document wins over tiny text. */
export async function renderCv(ast: ResumeAST, opts: { targetPages?: number; subject?: string } = {}): Promise<CvPdf> {
  const target = opts.targetPages ?? 2
  let last: CvPdf | null = null
  for (const s of [10.5, 10]) { last = await draw(ast, s, opts); if (last.pages <= target) return last }
  return last!
}
