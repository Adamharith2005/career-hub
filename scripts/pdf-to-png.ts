// Dev helper: renders every page of a PDF to PNG for visual review. Usage: node scripts/run-debug.mjs scripts/pdf-to-png.ts in.pdf outPrefix [scale]
import fs from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
const [inp, out, sc] = process.argv.slice(2)
const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(inp)), useSystemFonts: true, verbosity: 0 }).promise
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i); const vp = page.getViewport({ scale: Number(sc ?? 1.6) })
  const canvas = createCanvas(vp.width, vp.height); const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx as any, viewport: vp, canvas: canvas as any }).promise
  fs.writeFileSync(`${out}-${i}.png`, canvas.toBuffer('image/png')); console.log(`${out}-${i}.png`)
}
