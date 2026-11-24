import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FileDown, ShieldCheck, Sparkles } from 'lucide-react'
import { api, errMsg } from '../api'
import { Banner, Button, Spinner, useToast } from '../ui'
import { PdfPreview } from '../PdfPreview'
import { useV } from './vctx'

/** Resume page header. Akif: prepare, review and approve one refreshed master. Adam: his resume is never touched. Both: tailored CVs made per company. */
export function MasterPanel({ onChanged }: { onChanged: () => void }) {
  const { profileId, profile } = useV()
  const toast = useToast()
  const [cvs, setCvs] = useState<any[] | null>(null)
  const [draft, setDraft] = useState<any>(null)
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api('v.cv.list', { id: profileId }).then(setCvs).catch((e) => toast('bad', errMsg(e))), [profileId])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(null); setPdf(null); setCvs(null); load() }, [profileId])  // eslint-disable-line react-hooks/exhaustive-deps
  const isAkif = profileId === 'akif'
  const master = cvs?.find((r) => r.mode === 'MASTER')
  const approvedMaster = master?.versions.filter((v: any) => v.status === 'APPROVED').at(-1)
  const tailored = (cvs ?? []).filter((r) => r.mode === 'TAILORED')

  const prepare = async () => {
    setBusy(true)
    try { const v = await api('v.cv.master.create', { id: 'akif' }); setDraft(v); setPdf(await api('v.cv.preview', { id: 'akif', recId: v.rec.id, versionId: v.version.id })); await load() }
    catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const approve = async () => {
    setBusy(true)
    try { await api('v.cv.approve', { id: 'akif', recId: draft.rec.id, versionId: draft.version.id }); toast('ok', 'Approved. This is now the current master resume.'); setDraft(null); setPdf(null); await load(); onChanged() }
    catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  if (!cvs) return <Spinner label="Loading" />
  return (
    <div className="mb-8 space-y-6" data-testid="master-panel">
      {isAkif ? (
        <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="master-h">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-[60ch]"><h2 id="master-h" className="font-display text-[1.45rem] leading-tight">Master Resume (refresh)</h2>
              <p className="mt-1.5 text-[13.5px] text-muted">Built from {profile.displayName}’s verified profile: projects, leadership and experience exactly as recorded. Your earlier resume stays below, unchanged. Nothing becomes the master until you approve it.</p></div>
            {!draft && <Button variant="primary" onClick={prepare} busy={busy} icon={<Sparkles size={14} aria-hidden />} data-testid="prepare-master">{master ? 'Prepare a new draft' : 'Prepare Master Resume'}</Button>}
          </div>
          {approvedMaster && !draft && <p className="mt-3 flex items-center gap-1.5 text-[13px] text-ok"><CheckCircle2 size={14} aria-hidden />Current master approved {new Date(approvedMaster.approvedAt).toLocaleDateString()}. It is listed below as “Master resume (2026 refresh)”.</p>}
          {draft && (
            <div className="anim-fade-up mt-5 grid gap-6 lg:grid-cols-2" data-testid="master-draft">
              <div className="space-y-3">
                <Banner tone="info" title="Draft for your review">Check every line. Then approve it to save it as a new document and mark it as the current master.</Banner>
                {draft.flags.length > 0 && <Banner tone="warn" title="Check these first">{draft.flags.map((f: string) => <span key={f} className="block">{f}</span>)}</Banner>}
                {draft.version.ast.sections.length > 0 && <p className="text-[12.5px] text-muted">Sections: {draft.version.ast.sections.map((s: any) => s.title).join(', ')}.</p>}
                <div className="flex gap-2"><Button variant="primary" onClick={approve} busy={busy} icon={<ShieldCheck size={14} aria-hidden />} data-testid="approve-master">Approve as Master Resume</Button><Button variant="ghost" onClick={() => { setDraft(null); setPdf(null) }}>Not now</Button></div>
              </div>
              <div className="scroll-thin max-h-[60vh] overflow-auto rounded-lg border border-line bg-surface2 p-2">{pdf ? <PdfPreview bytes={pdf} label="Resume Preview" /> : <Spinner label="Drawing preview" />}</div>
            </div>)}
        </section>
      ) : (
        <Banner tone="info" title="Adam’s resume is kept exactly as saved">Career Hub never edits, reformats or tailors it. View it, download a copy or check its integrity below. Company CVs are separate files.</Banner>
      )}
      {tailored.length > 0 && (
        <section aria-labelledby="tailored-h"><h2 id="tailored-h" className="mb-2 text-[15px] font-bold">Tailored CVs</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="tailored-list">
            {tailored.map((r) => { const ap = r.versions.filter((v: any) => v.status === 'APPROVED').at(-1); return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13.5px]">
                <span className="min-w-0 flex-1"><span className="font-semibold">{r.companyName}</span><span className="text-muted"> · {r.role}</span><span className="block text-[12px] text-muted">{r.versions.length} version{r.versions.length > 1 ? 's' : ''} · {ap ? `approved ${new Date(ap.approvedAt).toLocaleDateString()}` : 'draft, not approved'}</span></span>
                {ap && <Button size="sm" variant="ghost" icon={<FileDown size={14} aria-hidden />} onClick={() => api('v.cv.export', { id: profileId, recId: r.id, versionId: ap.id }).then((p: string) => toast('ok', `Copied to ${p.split('/').pop()}`)).catch((e) => toast('bad', errMsg(e)))}>Save a copy</Button>}
              </li>) })}
          </ul></section>)}
    </div>
  )
}
