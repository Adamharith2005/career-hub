import { useEffect, useState } from 'react'
import { Archive, FileText, FolderOpen, Link2, Plus, Upload } from 'lucide-react'
import { api, errMsg, fmtDateTime } from './api'
import { Banner, Button, Chip, Empty, Select, Spinner, useToast, cx } from './ui'

const STATE: Record<string, { label: string; tone: 'ok' | 'bad' | 'warn' }> = { OK: { label: 'Intact', tone: 'ok' }, MISSING: { label: 'File missing', tone: 'bad' }, CHANGED: { label: 'Changed on disk', tone: 'warn' } }
const kb = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

export function ResumesPage() {
  const toast = useToast()
  const [list, setList] = useState<any[] | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api('resumes.list').then(setList).catch((e) => toast('bad', errMsg(e)))
  useEffect(() => { void load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (args: { path?: string; resumeId?: string } = {}) => {
    setBusy(true)
    try { const r = await api('resumes.add', args); if (r) { toast('ok', `Saved as version ${r.version}.`); await load() } } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void add({ path: window.careerHub.pathForFile(f) }) }

  return (
    <div className="space-y-6">
      <header><p className="eyebrow">Your own files</p><h1 className="page-title mt-1">My Resumes</h1>
        <p className="mt-1.5 max-w-2xl text-muted">Upload resumes you wrote yourself. Career Hub stores each file exactly as given, keeps every version, and lets you attach one to an application. It never writes or edits a resume here — tailored drafts come from CV Studio.</p></header>
      <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} className="card flex flex-col items-center gap-3 border-dashed p-7 text-center" data-testid="resume-drop">
        <FileText size={26} className="text-primary" aria-hidden />
        <p className="font-medium">Drop a PDF or Word file here</p>
        <Button variant="primary" busy={busy} onClick={() => add()} icon={<Upload size={15} aria-hidden />} data-testid="resume-add">Upload a resume</Button>
        <p className="text-xs text-muted">PDF or .docx, up to 10 MB. Stored on this computer, in this profile only.</p>
      </div>
      {!list ? <Spinner /> : list.length === 0 ? <Empty title="No resumes yet" icon={<FileText size={20} aria-hidden />}>Upload one to keep versions and attach it to applications.</Empty> : (
        <ul className="space-y-4">{list.map((r) => <ResumeCard key={r.resume_id} r={r} onAdd={() => add({ resumeId: r.resume_id })} reload={load} />)}</ul>
      )}
    </div>
  )
}

function ResumeCard({ r, onAdd, reload }: { r: any; onAdd: () => void; reload: () => void }) {
  const toast = useToast()
  const act = (p: Promise<any>, ok?: string) => p.then(() => { if (ok) toast('ok', ok); reload() }).catch((e) => toast('bad', errMsg(e)))
  return (
    <li className="card p-4" data-testid="resume-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-2xl">{r.label}</h2>
        <span className="flex-1" />
        <Button size="sm" onClick={onAdd} icon={<Plus size={14} aria-hidden />}>Add new version</Button>
        <Button size="sm" onClick={() => act(api('resumes.archive', { resumeId: r.resume_id, archived: true }), 'Archived. Versions are kept.')} icon={<Archive size={14} aria-hidden />}>Archive</Button>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
        {r.versions.map((v: any, i: number) => (
          <li key={v.version_id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
            <span className="tnum font-medium">v{String(v.version_number).padStart(2, '0')}</span>
            {i === 0 && <Chip tone="info">Latest</Chip>}
            <span className="min-w-0 flex-1 truncate text-muted" title={v.original_name}>{v.original_name} · {kb(v.size)} · {fmtDateTime(v.created_at)}</span>
            {v.attachedTo.length > 0 && <Chip tone="ok" icon={<Link2 size={11} aria-hidden />} title={v.attachedTo.map((a: any) => `${a.company_name} — ${a.role_title}`).join('\n')}>Attached to {v.attachedTo.length}</Chip>}
            <Chip tone={STATE[v.state].tone}>{STATE[v.state].label}</Chip>
            <Button size="sm" disabled={v.state === 'MISSING'} onClick={() => act(api('resumes.open', { versionId: v.version_id }))} icon={<FolderOpen size={14} aria-hidden />}>Open</Button>
          </li>
        ))}
      </ul>
      {r.versions.some((v: any) => v.state !== 'OK') && <div className="mt-3"><Banner tone="warn" title="A saved file no longer matches what you uploaded">Upload the file again as a new version. Career Hub will not attach a missing or altered file.</Banner></div>}
    </li>
  )
}

/** Attach one exact resume version to an application. Shown in the application's Documents tab. */
export function AttachResume({ appId, className }: { appId: string; className?: string }) {
  const toast = useToast()
  const [list, setList] = useState<any[] | null>(null)
  const [cur, setCur] = useState<any>(null)
  const load = () => Promise.all([api('resumes.list'), api('resumes.attached', { appId })]).then(([l, c]) => { setList(l); setCur(c) }).catch(() => {})
  useEffect(() => { void load() }, [appId])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return null
  const opts = list.flatMap((r) => r.versions.filter((v: any) => v.state === 'OK').map((v: any) => ({ id: v.version_id, text: `${r.label} · v${v.version_number}` })))
  const set = async (versionId: string) => {
    try { if (versionId) await api('resumes.attach', { appId, versionId }); else await api('resumes.detach', { appId }); await load() } catch (e) { toast('bad', errMsg(e)) }
  }
  return (
    <div className={cx('flex flex-wrap items-center gap-2 text-sm', className)} data-testid="attach-resume">
      <span className="font-medium">My resume for this application</span>
      <Select aria-label="Attached resume" className="h-9 w-auto py-1" value={cur?.version_id ?? ''} onChange={(e) => set(e.target.value)}>
        <option value="">None attached</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
      </Select>
      {cur && cur.state !== 'OK' && <Chip tone="bad">Attached file is {cur.state === 'MISSING' ? 'missing' : 'changed'}</Chip>}
      {opts.length === 0 && <span className="text-xs text-muted">Upload one in My Resumes first.</span>}
    </div>
  )
}
