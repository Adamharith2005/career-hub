import { useEffect, useState } from 'react'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { api, errMsg, fmtDateTime } from './api'
import { useApp } from './ctx'
import { Banner, Button, Chip, Empty, Spinner, useToast } from './ui'

const OUT: Record<string, { label: string; tone: 'ok' | 'info' | 'neutral' | 'warn' }> = { NEW: { label: 'New', tone: 'ok' }, CHANGED: { label: 'Changed', tone: 'info' }, UNCHANGED: { label: 'Unchanged', tone: 'neutral' }, CONFLICT: { label: 'Needs review', tone: 'warn' }, OFFICE_ADDED: { label: 'New office', tone: 'info' } }

export function ResearchImportPage() {
  const { refresh } = useApp()
  const toast = useToast()
  const [pv, setPv] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<any>(null)
  const [hist, setHist] = useState<any[] | null>(null)
  const [conf, setConf] = useState<any[]>([])
  const load = () => { api('research.history').then(setHist).catch((e) => toast('bad', errMsg(e))); api('research.conflicts').then(setConf).catch(() => {}) }
  useEffect(load, [])
  const pick = async () => { setBusy(true); setReport(null); try { const r = await api('research.pick'); if (r) setPv(r) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return
    setBusy(true); setReport(null)
    try { const path = window.careerHub.pathForFile(f); setPv(await api('research.preview', { path })) } catch (err) { toast('bad', errMsg(err)) } finally { setBusy(false) }
  }
  const run = async () => { setBusy(true); try { const r = await api('research.import', { path: pv.path }); setReport(r); setPv(null); toast('ok', r.alreadyImported ? 'Already imported — nothing changed.' : `Imported ${r.companies} organisations.`); await refresh(); load() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return (
    <div className="space-y-6">
      <header><p className="eyebrow">Shared research</p><h1 className="page-title mt-1">Research imports</h1>
        <p className="mt-1.5 max-w-2xl text-muted">Bring in updated internship spreadsheets. Imports only change company research — never your applications, notes, shortlists, CVs or resumes — and importing the same file twice changes nothing.</p></header>

      <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} className="card flex flex-col items-center gap-3 border-dashed p-8 text-center">
        <FileSpreadsheet size={28} className="text-primary" aria-hidden />
        <p className="font-medium">Drop an .xlsx workbook here</p>
        <Button variant="primary" busy={busy} onClick={pick} icon={<Upload size={15} aria-hidden />}>Choose a workbook</Button>
      </div>

      {pv && (
        <section className="card p-5" aria-label="Import preview">
          <h2 className="font-display text-2xl">{pv.filename}</h2>
          {pv.alreadyImported && <div className="mt-2"><Banner tone="info" title="This exact file was already imported">Importing again will not change anything.</Banner></div>}
          <div className="mt-3 flex flex-wrap gap-2">{Object.entries(pv.counts).map(([k, n]: any) => <Chip key={k} tone={OUT[k].tone}>{OUT[k].label}: <span className="tnum">{n}</span></Chip>)}</div>
          <p className="mt-3 text-sm text-muted">Worksheets: {pv.sheets.filter((s: any) => s.role !== 'OTHER').map((s: any) => `${s.name} (${s.rows} rows, ${Object.keys(s.mapping).length} columns recognised)`).join(' · ') || 'none recognised'}</p>
          {pv.warnings.map((w: string) => <p key={w} className="mt-1 text-sm text-warn">{w}</p>)}
          <ul className="mt-3 max-h-64 overflow-y-auto text-sm" aria-label="Preview of first 50 rows">{pv.sample.map((r: any) => <li key={r.name} className="flex items-center gap-2 border-t border-line py-1.5"><Chip tone={OUT[r.outcome].tone}>{OUT[r.outcome].label}</Chip><span className="min-w-0 flex-1 truncate">{r.name}</span><span className="text-xs text-muted">{r.city}</span></li>)}</ul>
          <div className="mt-4 flex gap-2"><Button variant="primary" busy={busy} onClick={run} disabled={pv.alreadyImported}>Import into Career Hub</Button><Button onClick={() => setPv(null)}>Cancel</Button></div>
          <p className="mt-2 text-xs text-muted">The import is a single transaction: if anything fails, nothing is written.</p>
        </section>
      )}
      {report && !report.alreadyImported && <Banner tone="ok" title="Import complete">{report.counts.NEW} new, {report.counts.CHANGED} changed, {report.counts.UNCHANGED} unchanged, {report.counts.CONFLICT} kept for review, {report.counts.OFFICE_ADDED} new offices. {report.allowanceRows} allowance records, {report.sources} cited sources.</Banner>}

      {conf.length > 0 && <section aria-label="Conflicts"><h2 className="eyebrow mb-2">Kept for review ({conf.length})</h2>
        <ul className="card divide-y divide-line">{conf.map((c) => <li key={c.row_id} className="p-3 text-sm"><span className="font-medium">{c.name}</span> <span className="text-muted">— the new file would lower: {(c.diff.conflicts ?? []).join(', ')}. The existing, stronger value was kept. ({c.filename})</span></li>)}</ul></section>}

      <section aria-label="Import history"><h2 className="eyebrow mb-2">History</h2>
        {!hist ? <Spinner /> : hist.length === 0 ? <div className="card"><Empty title="No imports yet" icon={<FileSpreadsheet size={20} aria-hidden />} /></div> :
          <ul className="card divide-y divide-line">{hist.map((h) => <li key={h.batch_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm"><span className="font-medium">{h.filename}</span><span className="text-muted tnum">{fmtDateTime(h.created_at)}</span><span className="text-muted tnum">{h.rows} rows</span></li>)}</ul>}
      </section>
    </div>
  )
}
