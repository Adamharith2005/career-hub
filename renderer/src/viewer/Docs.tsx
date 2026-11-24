import { useEffect, useState } from 'react'
import { Archive, Download, ExternalLink, FileText, Plus, Upload } from 'lucide-react'
import { api, errMsg, fmtDateTime, fmtSize } from '../api'
import { PdfPreview } from '../PdfPreview'
import { Banner, Button, Empty, Input, Select, Spinner, cx, useToast } from '../ui'
import { Mark } from './Marks'
import { useV } from './vctx'

export const FILE_STATE: Record<string, { label: string; tone: 'ok' | 'bad' | 'warn' }> = { OK: { label: 'Intact', tone: 'ok' }, MISSING: { label: 'File missing', tone: 'bad' }, CHANGED: { label: 'Changed on disk', tone: 'warn' } }

export function useDocs(profileId: string) {
  const [docs, setDocs] = useState<any[] | null>(null)
  const reload = () => api('v.docs.list', { id: profileId }).then(setDocs).catch(() => setDocs([]))
  useEffect(() => { setDocs(null); void reload() }, [profileId])  // eslint-disable-line react-hooks/exhaustive-deps
  return { docs, reload }
}

/** Previews one document version. PDF is rendered for real; Word shows its extracted text. */
export function Preview({ profileId, version, label }: { profileId: string; version: any; label: string }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const isDocx = /\.docx$/i.test(version?.file ?? '')
  useEffect(() => {
    setBytes(null); setText(null); setErr(null)
    if (!version || version.state === 'MISSING') return
    let live = true
    if (isDocx) api('v.docs.text', { id: profileId, versionId: version.id }).then((t) => live && setText(t)).catch((e) => live && setErr(errMsg(e)))
    else api('v.docs.bytes', { id: profileId, versionId: version.id }).then((b) => live && setBytes(b)).catch((e) => live && setErr(errMsg(e)))
    return () => { live = false }
  }, [profileId, version?.id, version?.state, isDocx])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!version) return null
  if (version.state === 'MISSING') return <Banner tone="bad" title="This file is missing from disk">Add it again as a new version. The saved record is intact.</Banner>
  if (err) return <Banner tone="warn" title="Preview unavailable">{err}</Banner>
  return (
    <div key={version.id} className="anim-fade-up" data-testid="doc-preview">
      {version.state === 'CHANGED' && <div className="mb-2"><Banner tone="warn" title="This file changed on disk since it was saved">What you see is the file as it is now.</Banner></div>}
      {isDocx ? (text == null ? <Spinner label="Reading Word file" /> : <pre className="scroll-thin max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface p-5 font-sans text-sm leading-relaxed">{text}</pre>)
        : <PdfPreview bytes={bytes} label={label} />}
    </div>
  )
}

export function DocActions({ profileId, version }: { profileId: string; version: any }) {
  const toast = useToast()
  const act = (p: Promise<any>, ok?: string) => p.then((r) => { if (ok) toast('ok', typeof r === 'string' && r ? `${ok} ${r}` : ok) }).catch((e) => toast('bad', errMsg(e)))
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={version.state === 'MISSING'} onClick={() => act(api('v.docs.open', { id: profileId, versionId: version.id }))} icon={<ExternalLink size={14} aria-hidden />}>View Resume file</Button>
      <Button size="sm" disabled={version.state === 'MISSING'} onClick={() => act(api('v.docs.exportCopy', { id: profileId, versionId: version.id }), 'Saved a copy to')} icon={<Download size={14} aria-hidden />}>Save a copy</Button>
    </div>
  )
}

/** Compact viewer: document + version pickers, preview, actions. Used on the profile page and inside company view. */
export function DocViewer({ profileId, docs }: { profileId: string; docs: any[] }) {
  const [docId, setDocId] = useState<string>(docs[0]?.id)
  const [verId, setVerId] = useState<string>(docs[0]?.versions[0]?.id)
  useEffect(() => { const d = docs.find((x) => x.id === docId) ?? docs[0]; setDocId(d?.id); if (!d?.versions.some((v: any) => v.id === verId)) setVerId(d?.versions[0]?.id) }, [docs])  // eslint-disable-line react-hooks/exhaustive-deps
  const doc = docs.find((d) => d.id === docId) ?? docs[0]
  const ver = doc?.versions.find((v: any) => v.id === verId) ?? doc?.versions[0]
  if (!doc || !ver) return null
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {docs.length > 1 && <Select aria-label="Document" className="h-9 w-auto py-1" value={doc.id} onChange={(e) => { const d = docs.find((x) => x.id === e.target.value); setDocId(d.id); setVerId(d.versions[0]?.id) }}>{docs.map((d) => <option key={d.id} value={d.id}>{d.label} ({d.kind === 'CV' ? 'CV' : 'Resume'})</option>)}</Select>}
        {doc.versions.length > 1 && <Select aria-label="Version" className="h-9 w-auto py-1" value={ver.id} onChange={(e) => setVerId(e.target.value)}>{doc.versions.map((v: any) => <option key={v.id} value={v.id}>v{v.version} · {fmtDateTime(v.addedAt)}</option>)}</Select>}
        <span className="flex items-center gap-1.5 text-xs text-muted"><Mark kind={ver.state === 'OK' ? 'verified' : ver.state === 'MISSING' ? 'none' : 'unverified'} />{FILE_STATE[ver.state].label}</span>
        <span className="flex-1" />
        <DocActions profileId={profileId} version={ver} />
      </div>
      <Preview profileId={profileId} version={ver} label={doc.label} />
    </div>
  )
}

/** Resume manager: upload, version, rename, archive and preview. Nothing is generated or edited. */
export function DocManager({ kind }: { kind?: 'RESUME' | 'CV' }) {
  const { profileId } = useV()
  const toast = useToast()
  const { docs, reload } = useDocs(profileId)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<{ docId: string; verId: string } | null>(null)
  const list = (docs ?? []).filter((d) => !kind || d.kind === kind)
  useEffect(() => { if (list.length && !list.some((d) => d.id === sel?.docId)) setSel({ docId: list[0].id, verId: list[0].versions[0]?.id }) }, [docs])  // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (args: { path?: string; docId?: string } = {}) => {
    setBusy(true)
    try { const r = await api('v.docs.add', { id: profileId, kind: kind ?? 'RESUME', ...args }); if (r) { toast('ok', `Saved as version ${r.version}.`); await reload(); setSel({ docId: r.docId, verId: '' }) } } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void add({ path: window.careerHub.pathForFile(f) }) }
  const doc = list.find((d) => d.id === sel?.docId)
  const ver = doc?.versions.find((v: any) => v.id === sel?.verId) ?? doc?.versions[0]
  const act = (p: Promise<any>, ok?: string) => p.then(() => { if (ok) toast('ok', ok); return reload() }).catch((e) => toast('bad', errMsg(e)))
  if (!docs) return <Spinner />
  return (
    <div className="grid gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="space-y-5">
        <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} className="flex flex-col items-start gap-2 border border-dashed border-line-strong p-5" data-testid="doc-drop">
          <p className="text-[14px] font-medium">Add a document</p><p className="text-[12.5px] text-muted">Drop a PDF or Word file here, or choose one. Up to 10 MB, stored privately on this computer.</p>
          <Button variant="primary" busy={busy} onClick={() => add()} icon={<Upload size={15} aria-hidden />} data-testid="doc-add">{kind === 'CV' ? 'Upload CV' : 'Upload Resume'}</Button>
          
        </div>
        {list.length === 0 ? <Empty title="Nothing here yet" icon={<FileText size={20} aria-hidden />}>Upload a file to keep versions and preview it here.</Empty> : (
          <ul>
            {list.map((d) => (
              <li key={d.id} data-testid="doc-card" className={cx('ledger-sel border-b border-line py-3 pl-4 pr-2', d.id === doc?.id && 'is-on')}>
                <div className="flex items-start gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSel({ docId: d.id, verId: d.versions[0]?.id })}>
                    <span className="block truncate text-[15px] font-semibold">{d.label}</span>
                    <span className="text-xs text-muted">{d.versions.length} version{d.versions.length === 1 ? '' : 's'} · {d.kind === 'CV' ? 'CV' : 'Resume'}</span>
                  </button>
                  <Button size="sm" variant="ghost" aria-label={`Add a new version of ${d.label}`} onClick={() => add({ docId: d.id })} icon={<Plus size={14} aria-hidden />}>Version</Button>
                  <Button size="sm" variant="ghost" aria-label={`Archive ${d.label}`} onClick={() => act(api('v.docs.archive', { id: profileId, docId: d.id, archived: true }), 'Archived. Versions are kept.')} icon={<Archive size={14} aria-hidden />} />
                </div>
                <ul className="mt-2 space-y-1">
                  {d.versions.map((v: any) => (
                    <li key={v.id}><button onClick={() => setSel({ docId: d.id, verId: v.id })} className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-surface2', ver?.id === v.id && 'bg-primary-soft')}>
                      <span className="num-display font-medium">v{String(v.version).padStart(2, '0')}</span>
                      <span className="min-w-0 flex-1 truncate text-muted">{v.originalName} · {fmtSize(v.size)}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted"><Mark kind={v.state === 'OK' ? 'verified' : v.state === 'MISSING' ? 'none' : 'unverified'} />{FILE_STATE[v.state].label}</span></button></li>
                  ))}
                </ul>
                {doc?.id === d.id && <RenameKind profileId={profileId} doc={d} onChange={() => reload()} />}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        {ver ? <><div className="mb-3 flex items-center gap-2"><h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{doc.label} <span className="num-display text-sm font-normal text-muted">v{String(ver.version).padStart(2, '0')}</span></h2><DocActions profileId={profileId} version={ver} /></div><Preview profileId={profileId} version={ver} label={doc.label} /></>
          : <Empty title="Select a file to preview" icon={<FileText size={20} aria-hidden />} />}
      </div>
    </div>
  )
}

function RenameKind({ profileId, doc, onChange }: { profileId: string; doc: any; onChange: () => void }) {
  const toast = useToast()
  const [label, setLabel] = useState(doc.label)
  useEffect(() => setLabel(doc.label), [doc.id, doc.label])
  const save = () => { if (label.trim() && label !== doc.label) api('v.docs.rename', { id: profileId, docId: doc.id, label }).then(onChange).catch((e) => toast('bad', errMsg(e))) }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <Input aria-label="Name" className="h-9 min-w-0 flex-1 py-1 text-[13px]" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <Select aria-label="Type" className="h-9 w-auto py-1 text-[13px]" value={doc.kind} onChange={(e) => api('v.docs.kind', { id: profileId, docId: doc.id, kind: e.target.value }).then(onChange).catch((x) => toast('bad', errMsg(x)))}><option value="RESUME">Resume</option><option value="CV">CV</option></Select>
    </div>
  )
}
