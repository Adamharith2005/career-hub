import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FileDown, History, RefreshCw, TriangleAlert } from 'lucide-react'
import { api, errMsg } from '../api'
import { Banner, Button, Modal, Select, Spinner, Textarea, cx, useToast } from '../ui'
import { PdfPreview } from '../PdfPreview'
import { Bar, MatchRing } from './Meter'
import { useV } from './vctx'

const KIND: Record<string, { cls: string; label: string }> = { added: { cls: 'diff-add', label: 'Added' }, removed: { cls: 'diff-del', label: 'Left out' }, moved: { cls: 'diff-mov', label: 'Reordered' }, reworded: { cls: 'diff-edit', label: 'Reworded' }, emphasised: { cls: 'diff-mov', label: 'Emphasised' } }

/** Tailor a CV to one company and role. Draft, review, edit, approve, export. Works the same for both students. */
export function CvStudio({ company, role: initialRole, roles, onClose }: { company: any; role: string; roles: { id: string; label: string }[]; onClose: () => void }) {
  const { profileId, profile } = useV()
  const toast = useToast()
  const [role, setRole] = useState(initialRole)
  const [view, setView] = useState<any>(null)
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [tab, setTab] = useState<'changes' | 'edit'>('changes')
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState(false)
  const [done, setDone] = useState<{ file: string } | null>(null)
  const [summary, setSummary] = useState('')

  const show = useCallback(async (v: any) => {
    setView(v); setSummary(v.version.ast.summary?.text ?? ''); setDone(v.version.status === 'APPROVED' ? { file: v.version.file } : null); setAck(false)
    try { setPdf(await api('v.cv.preview', { id: profileId, recId: v.rec.id, versionId: v.version.id })) } catch (e) { toast('bad', errMsg(e)) }
  }, [profileId])  // eslint-disable-line react-hooks/exhaustive-deps
  const generate = useCallback(async (recId?: string) => {
    setBusy(true); setPdf(null)
    try { await show(await api('v.cv.tailor', { profileId, companyId: company.id, role, recId })) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }, [profileId, company.id, role, show])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { generate() }, [role])  // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<any>) => { setBusy(true); try { await show(await fn()) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const approve = async () => {
    setBusy(true)
    try { const r = await api('v.cv.approve', { id: profileId, recId: view.rec.id, versionId: view.version.id, acknowledgeFlags: ack }); setDone({ file: r.version.file }); toast('ok', 'Approved. The PDF is saved.'); setView((v: any) => ({ ...v, version: r.version })); setPdf(await api('v.cv.preview', { id: profileId, recId: view.rec.id, versionId: view.version.id })) }
    catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const exportPdf = async () => { try { const p = await api('v.cv.export', { id: profileId, recId: view.rec.id, versionId: view.version.id }); toast('ok', `Copied to ${p.split('/').pop()}`) } catch (e) { toast('bad', errMsg(e)) } }
  const flags: string[] = view?.flags ?? []
  const pres = view?.presentation
  const approved = view?.version.status === 'APPROVED'

  return (
    <Modal wide title={`Tailor ${profile.displayName}’s CV for ${company.name}`} onClose={onClose}
      footer={view && <div className="flex w-full flex-wrap items-center gap-2">
        <span className="mr-auto text-[12.5px] text-muted">{approved ? <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 size={14} aria-hidden />Approved version {view.version.n}</span> : `Draft version ${view.version.n}. Nothing is approved until you approve it.`}</span>
        {!approved && flags.length > 0 && <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="accent-[var(--primary)]" />I have checked the flagged claims</label>}
        <Button variant="ghost" onClick={() => generate(view.rec.id)} busy={busy} icon={<RefreshCw size={14} aria-hidden />}>Regenerate</Button>
        {approved ? <Button variant="primary" onClick={exportPdf} icon={<FileDown size={14} aria-hidden />} data-testid="cv-export">Save a copy of the PDF</Button>
          : <Button variant="primary" onClick={approve} busy={busy} disabled={flags.length > 0 && !ack} data-testid="cv-approve">Approve and save PDF</Button>}
      </div>}>
      {!view ? <Spinner label="Preparing your tailored CV" /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="cv-studio">
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-primary-soft px-3 py-1 text-[12.5px] font-bold text-primary" data-testid="cv-label">{view.label ?? 'Tailored CV'}</span>
              <label className="flex items-center gap-1.5 text-[13px] font-semibold">Role<Select aria-label="CV role" className="h-8 w-auto py-0.5 text-[13px]" value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></label>
            </div>
            <p className="text-[13px] text-muted">Only facts already in {profile.displayName}’s profile are used. Tailoring changes order, emphasis and the summary. It does not add skills, projects or numbers.</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-4"><p className="mb-2 text-[12.5px] font-bold">Applicant–role suitability</p>{view.suitability && <MatchRing score={view.suitability.score} tier={view.suitability.tier} provisional={view.suitability.provisional} size={72} />}<p className="mt-2 text-[12px] text-muted">Based on what {profile.displayName} knows. Rewording the CV does not change it.</p></div>
              <div className="rounded-xl border border-line p-4" data-testid="presentation"><p className="mb-2 text-[12.5px] font-bold">CV evidence presentation</p>
                <div className="space-y-1.5 text-[12.5px]"><div className="flex justify-between"><span>Master CV</span><span className="figure">{pres.before.percent}%</span></div><Bar value={pres.before.percent / 100} tone="var(--faint)" />
                  <div className="flex justify-between pt-1"><span className="font-semibold">This CV</span><span className="figure">{pres.after.percent}%</span></div><Bar value={pres.after.percent / 100} tone="var(--accent)" delay={120} /></div>
                <p className="mt-2 text-[12px] text-muted">How much of your relevant evidence a reader sees near the top. Not an ATS score or a chance of being hired.</p></div>
            </div>
            {pres.after.gaps.length > 0 && <p className="text-[12.5px] text-muted"><span className="font-semibold text-ink">Genuine gaps this CV cannot fix:</span> {pres.after.gaps.join(', ')}.</p>}

            {flags.length > 0 && <Banner tone="warn" title="Check these claims before approving">{flags.map((f) => <span key={f} className="flex gap-1.5"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{f}</span>)}</Banner>}

            <div role="tablist" className="flex gap-1 border-b border-line">
              {(['changes', 'edit'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('-mb-px border-b-2 px-3 py-1.5 text-[13.5px] font-semibold', tab === t ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}>{t === 'changes' ? `What changed (${view.diff.length})` : 'Edit wording'}</button>)}
            </div>
            {tab === 'changes' ? (
              <ul className="stagger space-y-2" data-testid="cv-diff">
                {view.diff.length === 0 && <li className="text-[13px] text-muted">No differences from the general CV.</li>}
                {view.diff.map((c: any, i: number) => (
                  <li key={i} className={cx('rounded-md px-3 py-2 text-[13px]', KIND[c.kind]?.cls)}>
                    <p className="text-[11.5px] font-bold uppercase-none text-muted">{KIND[c.kind]?.label} · {c.where}</p>
                    <p className="mt-0.5 font-medium [overflow-wrap:anywhere]">{c.text}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">{c.why}</p>
                  </li>))}
              </ul>
            ) : (
              <div className="space-y-4" data-testid="cv-edit">
                <div><label className="mb-1 block text-[13px] font-semibold" htmlFor="cv-sum">Summary</label><Textarea id="cv-sum" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
                  <div className="mt-2 flex gap-2"><Button size="sm" disabled={busy || summary === view.version.ast.summary?.text || approved} onClick={() => act(() => api('v.cv.edit', { id: profileId, recId: view.rec.id, versionId: view.version.id, summary }))}>Save as new version</Button></div></div>
                <ul className="space-y-1.5">{view.version.ast.sections.flatMap((s: any) => (s.items ?? []).flatMap((it: any) => it.bullets.map((b: any) => ({ s: s.title, it: it.heading, b })))).map(({ s, it, b }: any) => (
                  <li key={b.id} className="flex items-start gap-2 text-[12.5px]"><span className="min-w-0 flex-1"><span className="block text-muted">{s} › {it}</span>{b.text}</span><Button size="sm" variant="ghost" disabled={busy || approved} onClick={() => act(() => api('v.cv.edit', { id: profileId, recId: view.rec.id, versionId: view.version.id, bullets: { [b.id]: null } }))}>Remove</Button></li>))}</ul>
              </div>)}
            {view.rec.versions.length > 1 && <details className="text-[13px]"><summary className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-muted"><History size={14} aria-hidden />Version history ({view.rec.versions.length})</summary>
              <ul className="mt-2 space-y-1">{[...view.rec.versions].reverse().map((v: any) => <li key={v.id} className="flex items-center gap-2"><span className="figure w-6 text-[12.5px]">v{v.n}</span><span className="flex-1 text-muted">{v.status === 'APPROVED' ? 'Approved' : 'Draft'} · {v.note}</span>{v.id !== view.version.id && <Button size="sm" variant="ghost" onClick={() => act(() => api('v.cv.restore', { id: profileId, recId: view.rec.id, versionId: v.id }))}>Restore</Button>}</li>)}</ul></details>}
            {done && <p className="text-[12.5px] text-muted">Saved as {done.file}</p>}
          </div>
          <div className="min-w-0"><p className="mb-2 text-[12.5px] font-bold text-muted">Preview of the exported PDF</p><div className="scroll-thin max-h-[70vh] overflow-auto rounded-lg border border-line bg-surface2 p-2">{pdf ? <PdfPreview bytes={pdf} label="Tailored CV preview" /> : <Spinner label="Drawing preview" />}</div></div>
        </div>)}
    </Modal>
  )
}
