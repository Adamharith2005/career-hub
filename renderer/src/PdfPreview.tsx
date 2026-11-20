import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Spinner } from './ui'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Renders the REAL exported PDF (not a mock-up) page by page onto A4-proportioned canvases. */
export function PdfPreview({ bytes, label }: { bytes: Uint8Array | null; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ loading: boolean; error: string | null; pages: number }>({ loading: false, error: null, pages: 0 })
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = host.current; if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)))
    ro.observe(el); setWidth(Math.round(el.clientWidth))
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = host.current
    if (!el || !bytes || width < 100) return
    let cancelled = false
    setState({ loading: true, error: null, pages: 0 })
    const task = pdfjs.getDocument({ data: bytes.slice() })
    ;(async () => {
      try {
        const doc = await task.promise
        const frag = document.createDocumentFragment()
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const scale = (width / base.width) * dpr
          const vp = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height)
          canvas.style.width = '100%'; canvas.style.display = 'block'
          canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${label}, page ${n} of ${doc.numPages}`)
          await page.render({ canvas, viewport: vp } as any).promise
          const sheet = document.createElement('div')
          sheet.className = 'a4-sheet mb-3 overflow-hidden rounded-[3px] bg-white shadow-[0_1px_3px_rgba(0,0,0,.18),0_8px_24px_rgba(0,0,0,.08)]'
          sheet.dataset.page = String(n)
          sheet.appendChild(canvas); frag.appendChild(sheet)
        }
        if (cancelled) return
        el.replaceChildren(frag)
        setState({ loading: false, error: null, pages: doc.numPages })
      } catch (e: any) { if (!cancelled) setState({ loading: false, error: e?.message ?? 'Could not draw the PDF', pages: 0 }) }
    })()
    return () => { cancelled = true; void task.destroy() }
  }, [bytes, width, label])

  return (
    <div className="relative rounded-lg bg-surface2 p-3" data-testid="pdf-preview" data-pages={state.pages}>
      {!bytes && <p className="p-6 text-center text-sm text-muted">No file to preview.</p>}
      {state.loading && <Spinner label="Drawing preview" />}
      {state.error && <p role="alert" className="p-4 text-sm text-bad">Preview unavailable: {state.error}. The PDF itself is saved in your folder.</p>}
      <div ref={host} />
    </div>
  )
}
