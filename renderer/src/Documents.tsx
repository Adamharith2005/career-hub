import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Diff, FileText, FolderOpen, RefreshCw, Save, Undo2, Undo, X, XCircle } from 'lucide-react'
import { api, errMsg, fmtDateTime } from './api'
import { useApp } from './ctx'
import { PdfPreview } from './PdfPreview'
import { Banner, Button, Chip, Empty, Field, Input, Select, Textarea, Toggle, cx, useToast } from './ui'

type DocType = 'RESUME' | 'COVER_LETTER'

export function DocumentsTab({ detail, reload }: { detail: any; reload: () => void }) {
  const { boot, go } = useApp()
  const toast = useToast()
  const [type, setType] = useState<DocType>('RESUME')
  const [lang, setLang] = useState<'en' | 'ms'>(boot.profile.prefs.language ?? 'en')
  const [useAi, setUseAi] = useState(false)
  const [busy, setBusy] = useState(false)
  const [issues, setIssues] = useState<any[] | null>(null)
  const [aiNote, setAiNote] = useState<any>(null)
  const [ai, setAi] = useState<any>(null)
  const [factsCount, setFactsCount] = useState<number | null>(null)
  useEffect(() => { api('ai.get').then(setAi).catch(() => {}); api('facts.list').then((f) => setFactsCount(f.filter((x: any) => x.confirmed).length)).catch(() => {}) }, [])
  const docs: any[] = detail.docs
  const app = detail.app

  const generate = async () => {
    setBusy(true); setIssues(null); setAiNote(null)
    try {
      const r = await api('docs.generate', { appId: app.application_id, language: lang, useAi })
      if (!r.ok) { setIssues(r.issues); return }
      setAiNote(r.aiNote)
      toast(r.resume.qa.passed && r.letter.qa.passed ? 'ok' : 'warn', r.resume.qa.passed && r.letter.qa.passed ? 'Resume and cover letter are ready — every check passed.' : 'Documents created, but some checks need attention.')
      reload()
    } catch (e: any) {
      if (e.code === 'NO_FACTS') toast('warn', errMsg(e)); else toast('bad', errMsg(e))
    } finally { setBusy(false) }
  }

  if (!docs.length) {
    return (
      <div className="mx-auto max-w-xl py-6">
        <Empty title="No documents yet" icon={<FileText size={20} aria-hidden />}>
          We’ll build a one-page, ATS-friendly resume and a cover letter from your confirmed facts, check every claim against them, and save PDF + Word files to this application’s folder. Nothing is invented.
        </Empty>
        <div className="mt-2 space-y-4 rounded-xl border border-line bg-surface p-4">
          {factsCount === 0 && <Banner tone="warn" title="Confirm your profile first" action={<Button size="sm" onClick={() => go('profile')}>Open My Profile</Button>}>Documents are built only from confirmed facts. You have none yet.</Banner>}
          {!boot.profile.storage_root && <Banner tone="warn" title="Choose a folder first">Open Settings → Storage so files have somewhere to be saved.</Banner>}
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Document language">{(id) => <Select id={id} value={lang} onChange={(e) => setLang(e.target.value as any)}><option value="en">English</option><option value="ms">Bahasa Malaysia</option></Select>}</Field></div>
          <AiOption ai={ai} on={useAi} setOn={setUseAi} />
          {issues && <IssueList issues={issues} title="Blocked by the fact check — nothing was exported" />}
          <Button variant="primary" busy={busy} disabled={!factsCount || !boot.profile.storage_root} onClick={generate} data-testid="generate-docs">Generate documents</Button>
        </div>
      </div>
    )
  }
  return <Editor key={`${app.application_id}`} detail={detail} type={type} setType={setType} reload={reload} onRegenerate={generate} busy={busy} lang={lang} setLang={setLang} ai={ai} useAi={useAi} setUseAi={setUseAi} issues={issues} setIssues={setIssues} aiNote={aiNote} />
}

function AiOption({ ai, on, setOn }: { ai: any; on: boolean; setOn: (b: boolean) => void }) {
  if (!ai?.provider) return <p className="text-xs text-muted">AI wording is off. The template cover letter is written from your facts without sending anything anywhere.</p>
  if (!ai.consented && !ai.local) return <p className="text-xs text-muted">AI is set up but not yet allowed to receive your facts. Enable consent in Settings → AI.</p>
  return <div><Toggle on={on} onClick={() => setOn(!on)}>Polish the cover letter with AI ({ai.host})</Toggle><p className="mt-1 text-xs text-muted">The AI version is fact-checked; if it adds anything unsupported it is rejected and the template letter is used.</p></div>
}

export function IssueList({ issues, title }: { issues: any[]; title: string }) {
  return (
    <Banner tone="bad" title={title}>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{issues.slice(0, 8).map((i, n) => <li key={n}><strong>{i.where}:</strong> {i.message}</li>)}</ul>
      {issues.length > 8 && <p className="mt-1 text-xs">…and {issues.length - 8} more.</p>}
    </Banner>
  )
}

// ---------------------------------------------------------------- editor
function Editor({ detail, type, setType, reload, onRegenerate, busy, lang, setLang, ai, useAi, setUseAi, issues, setIssues, aiNote }: any) {
  const toast = useToast()
  const app = detail.app
  const versions: any[] = useMemo(() => detail.docs.filter((d: any) => d.doc_type === type).sort((a: any, b: any) => b.version_number - a.version_number), [detail.docs, type])
  const [docId, setDocId] = useState<string>(versions[0]?.doc_id)
  useEffect(() => { if (!versions.find((v) => v.doc_id === docId)) setDocId(versions[0]?.doc_id) }, [versions, docId])
  const saved = versions.find((v) => v.doc_id === docId) ?? versions[0]
  const [ast, setAst] = useState<any>(saved?.ast)
  const [undo, setUndo] = useState<any[]>([])
  const [dirty, setDirty] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [regen, setRegen] = useState('')
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [pdfErr, setPdfErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setAst(saved?.ast); setUndo([]); setDirty(false); setIssues(null) }, [saved?.doc_id])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setBytes(null); setPdfErr(null)
    if (saved) api('docs.pdfBytes', { docId: saved.doc_id }).then(setBytes).catch((e) => setPdfErr(errMsg(e)))
  }, [saved?.doc_id, saved?.pdf_sha256])                                                         // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback((fn: (draft: any) => void) => {
    setAst((cur: any) => { setUndo((u) => [...u.slice(-30), cur]); const d = structuredClone(cur); fn(d); return d })
    setDirty(true)
  }, [])
  const doUndo = () => setUndo((u) => { if (!u.length) return u; setAst(u[u.length - 1]); setDirty(u.length > 1); return u.slice(0, -1) })

  const save = async () => {
    setSaving(true); setIssues(null)
    try {
      const r = await api('docs.saveEdit', { docId: saved.doc_id, ast })
      if (!r.ok) { setIssues(r.issues); return }
      toast(r.qa.passed ? 'ok' : 'warn', r.qa.passed ? `Saved as version ${r.version}. All checks passed.` : `Saved as version ${r.version}, but a check failed — see Export checks.`)
      setDocId(r.doc_id); reload()
    } catch (e) { toast('bad', errMsg(e)) } finally { setSaving(false) }
  }
  const open = (which: 'pdf' | 'docx') => api('docs.open', { docId: saved.doc_id, which }).catch((e) => toast('bad', errMsg(e)))
  const missing = detail.docs.filter((d: any) => d.pdfState !== 'ok' || d.docxState !== 'ok')
  const isR = type === 'RESUME'
  // While switching document type the previous AST is still in state for one render; never draw it with the wrong editor.
  const astOk = !!ast && (isR ? Array.isArray(ast.sections) : Array.isArray(ast.paragraphs))
  const sections: any[] = isR && astOk ? ast.sections : []

  return (
    <div>
      {missing.length > 0 && <div className="mb-3"><Banner tone="warn" title="Some saved files are missing or changed on disk" action={<Button size="sm" busy={busy} onClick={onRegenerate}>Regenerate files</Button>}>{missing.map((d: any) => `${d.doc_type === 'RESUME' ? 'Resume' : 'Cover letter'} v${d.version_number}`).join(', ')}. Your records are intact; regenerating creates a new version and never overwrites old ones.</Banner></div>}
      {aiNote && aiNote.status !== 'not_used' && aiNote.status !== 'used' && <div className="mb-3"><Banner tone="warn" title="AI wording was not used">{aiNote.message}</Banner></div>}
      {issues && <div className="mb-3"><IssueList issues={issues} title="Blocked by the fact check — nothing was saved" /></div>}

      <div className="mb-3 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Document tools">
        <div className="flex rounded-lg border border-line-strong bg-surface p-0.5" role="group" aria-label="Document">
          {(['RESUME', 'COVER_LETTER'] as const).map((t) => <button key={t} aria-pressed={type === t} onClick={() => setType(t)} className={cx('rounded-md px-3 py-1 text-sm', type === t ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:text-ink')}>{t === 'RESUME' ? 'Resume' : 'Cover letter'}</button>)}
        </div>
        <Select aria-label="Version" className="h-9 w-auto py-1" value={saved?.doc_id} onChange={(e) => { if (dirty && !window.confirm('Discard unsaved edits?')) return; setDocId(e.target.value) }}>
          {versions.map((v) => <option key={v.doc_id} value={v.doc_id}>v{v.version_number} · {fmtDateTime(v.created_at)}{v.is_submitted_version ? ' · submitted' : ''}</option>)}
        </Select>
        {saved?.is_submitted_version === 1 && <Chip tone="info">Submitted version — never overwritten</Chip>}
        <span className="flex-1" />
        <Button size="sm" onClick={doUndo} disabled={!undo.length} icon={<Undo2 size={14} aria-hidden />}>Undo</Button>
        {isR && <Button size="sm" onClick={() => setShowDiff(!showDiff)} aria-pressed={showDiff} icon={<Diff size={14} aria-hidden />} className={cx(showDiff && 'border-primary bg-primary-soft text-primary')}>Diff vs master</Button>}
        {isR && <div className="flex items-center gap-1"><Select aria-label="Section to regenerate" className="h-8 w-auto py-0 text-[13px]" value={regen} onChange={(e) => setRegen(e.target.value)}><option value="">Regenerate section…</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</Select>
          <Button size="sm" disabled={!regen} onClick={async () => { try { const n = await api('docs.regenSection', { appId: app.application_id, sectionId: regen, ast }); apply(() => {}); setAst(n); setDirty(true); toast('ok', 'Section rebuilt from your confirmed facts. Save to keep it.') } catch (e) { toast('bad', errMsg(e)) } }} icon={<RefreshCw size={14} aria-hidden />} aria-label="Regenerate selected section" /></div>}
        <Button size="sm" onClick={() => open('pdf')}>PDF</Button><Button size="sm" onClick={() => open('docx')}>Word</Button>
        <Button size="sm" onClick={() => api('fs.openAppFolder', { appId: app.application_id }).catch((e) => toast('bad', errMsg(e)))} icon={<FolderOpen size={14} aria-hidden />}>Open folder</Button>
        <Button variant="primary" size="sm" busy={saving} disabled={!dirty} onClick={save} icon={<Save size={14} aria-hidden />}>Save version</Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-4" data-testid="doc-editor">
          {astOk ? (isR ? <ResumeEditor ast={ast} apply={apply} showDiff={showDiff} /> : <LetterEditor ast={ast} apply={apply} />) : null}
          <div className="border-t border-line pt-3"><AiOption ai={ai} on={useAi} setOn={setUseAi} />
            <div className="mt-2 flex flex-wrap items-center gap-2"><Select aria-label="Language" className="h-8 w-auto py-0 text-[13px]" value={lang} onChange={(e) => setLang(e.target.value)}><option value="en">English</option><option value="ms">Bahasa Malaysia</option></Select><Button size="sm" busy={busy} onClick={() => { if (dirty && !window.confirm('Regenerating creates new versions and ignores unsaved edits. Continue?')) return; void onRegenerate() }} icon={<RefreshCw size={14} aria-hidden />}>Regenerate both documents</Button></div></div>
        </div>

        <div className="min-w-0 space-y-3">
          <ExportChecks doc={saved} />
          {pdfErr ? <Banner tone="warn" title="Preview unavailable">{pdfErr}</Banner> : <PdfPreview bytes={bytes} label={isR ? 'Resume preview' : 'Cover letter preview'} />}
          {dirty && <p className="text-xs text-muted">The preview shows the last saved version. Save to regenerate the PDF and Word files with your edits.</p>}
        </div>
      </div>
    </div>
  )
}

const shortId = (s: string) => s.replace(/^f_/, '').slice(0, 4)

function ResumeEditor({ ast, apply, showDiff }: { ast: any; apply: (fn: (d: any) => void) => void; showDiff: boolean }) {
  return (
    <div className="space-y-5">
      <div><p className="text-lg font-semibold">{ast.header.name}</p><p className="text-xs text-muted">{ast.header.contacts.map((c: any) => c.text).join('  ·  ')} <span className="text-faint">(from My Profile)</span></p></div>
      {ast.summary && <div><SectionLabel>Profile line</SectionLabel><AutoText label="Profile line" value={ast.summary.text} onChange={(v) => apply((d) => { d.summary.text = v })} /><Sources ids={ast.summary.factIds} /></div>}
      {ast.sections.map((s: any, si: number) => (
        <section key={s.id} aria-label={s.title} data-section={s.id}>
          <SectionLabel>{s.title}</SectionLabel>
          {(s.skillGroups ?? []).map((g: any, gi: number) => (
            <div key={gi} className="mb-1.5 flex flex-wrap items-center gap-1.5 text-sm"><span className="font-medium">{g.label}:</span>{g.values.map((v: string, vi: number) => <span key={v + vi} className="inline-flex items-center gap-0.5 rounded-md bg-surface2 px-1.5 py-0.5 text-[13px]">{v}<button aria-label={`Remove ${v}`} className="text-faint hover:text-bad" onClick={() => apply((d) => { d.sections[si].skillGroups[gi].values.splice(vi, 1) })}><X size={12} aria-hidden /></button></span>)}</div>
          ))}
          {(s.items ?? []).map((it: any, ii: number) => (
            <div key={it.id} className="mb-3 rounded-lg border border-line p-2.5">
              <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{it.heading}{it.dates && <span className="tnum ml-2 text-xs font-normal text-muted">{it.dates}</span>}</p>{it.subheading && <p className="text-xs italic text-muted">{it.subheading}</p>}</div>
                <button aria-label={`Remove ${it.heading} from this resume`} className="rounded p-1 text-faint hover:bg-surface2 hover:text-bad" onClick={() => apply((d) => { d.sections[si].items.splice(ii, 1) })}><X size={14} aria-hidden /></button></div>
              {it.bullets.map((b: any, bi: number) => {
                const edited = b.text !== b.original
                return (
                  <div key={b.id} className="mt-2" data-bullet={b.id}>
                    <div className="flex gap-1.5"><span aria-hidden className="mt-2 text-muted">•</span>
                      <AutoText value={b.text} label={`${it.heading} bullet ${bi + 1}`} onChange={(v) => apply((d) => { d.sections[si].items[ii].bullets[bi].text = v })} />
                      <div className="flex shrink-0 flex-col gap-0.5">
                        {edited && <button aria-label="Revert this bullet to your master wording" title="Revert to master wording" className="rounded p-1 text-primary hover:bg-primary-soft" onClick={() => apply((d) => { d.sections[si].items[ii].bullets[bi].text = b.original })}><Undo size={14} aria-hidden /></button>}
                        <button aria-label="Remove bullet" className="rounded p-1 text-faint hover:bg-surface2 hover:text-bad" onClick={() => apply((d) => { d.sections[si].items[ii].bullets.splice(bi, 1) })}><X size={14} aria-hidden /></button></div></div>
                    <div className="ml-4 mt-0.5 flex flex-wrap items-center gap-1.5">{showDiff && <Chip tone={edited ? 'warn' : 'ok'}>{edited ? 'Edited' : 'Verbatim from master'}</Chip>}<Sources ids={b.sourceFactIds} /></div>
                    {showDiff && edited && <p className="ml-4 mt-1 rounded bg-surface2 px-2 py-1 text-xs text-muted"><span className="font-medium">Master:</span> {b.original}</p>}
                  </div>
                )
              })}
            </div>
          ))}
        </section>
      ))}
      {showDiff && <WhatChanged ast={ast} />}
    </div>
  )
}

function WhatChanged({ ast }: { ast: any }) {
  const log: any[] = ast.changelog ?? []
  return (
    <section className="rounded-lg bg-surface2 p-3" aria-label="What changed">
      <p className="mb-1.5 text-sm font-semibold">What changed from your master</p>
      <ul className="space-y-1 text-xs text-muted">{log.map((c, i) => <li key={i}><Chip tone={c.kind === 'omitted' ? 'neutral' : c.kind === 'ordered' ? 'info' : 'ok'} className="mr-1.5">{c.kind}</Chip>{c.section}{c.factId && <span className="ml-1 rounded bg-surface px-1 font-mono">{shortId(c.factId)}</span>} — {c.reason}</li>)}</ul>
    </section>
  )
}

function LetterEditor({ ast, apply }: { ast: any; apply: (fn: (d: any) => void) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Subject line">{(id) => <Input id={id} value={ast.subject} onChange={(e) => apply((d) => { d.subject = e.target.value })} />}</Field>
      <p className="text-sm text-muted">{ast.salutation}</p>
      {ast.paragraphs.map((p: any, i: number) => (
        <div key={p.id}><AutoText value={p.text} label={`Paragraph ${i + 1}`} onChange={(v) => apply((d) => { d.paragraphs[i].text = v })} /><Sources ids={p.factIds} />
          <button aria-label={`Remove paragraph ${i + 1}`} className="mt-0.5 text-xs text-faint hover:text-bad" onClick={() => apply((d) => { d.paragraphs.splice(i, 1) })}>Remove paragraph</button></div>
      ))}
      <p className="text-sm text-muted">{ast.closing}<br />{ast.signature}</p>
      <p className="text-xs text-muted">Sender details, date and recipient come from your profile and the application. Every claim is re-checked against your facts when you save.</p>
    </div>
  )
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h4>
function Sources({ ids }: { ids: string[] }) {
  if (!ids?.length) return <span className="text-[11px] text-bad">No source fact</span>
  return <span className="inline-flex flex-wrap items-center gap-1 text-[11px] text-faint">Source{ids.length > 1 ? 's' : ''}: {ids.map((i) => <code key={i} className="rounded bg-surface2 px-1 font-mono" title={`Fact ${i}`}>{shortId(i)}</code>)}</span>
}
function AutoText({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px` } }, [value])
  return <Textarea ref={ref} aria-label={label} rows={1} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-0 w-full resize-none py-1.5 text-[13.5px]" />
}

// ---------------------------------------------------------------- verified-only indicators
function ExportChecks({ doc }: { doc: any }) {
  const [open, setOpen] = useState(false)
  if (!doc) return null
  const qa = doc.qa, fc = doc.factCheck
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        {qa?.passed ? <Chip tone="ok" icon={<CheckCircle2 size={12} aria-hidden />}>ATS-safe layout</Chip> : <Chip tone="bad" icon={<XCircle size={12} aria-hidden />}>Layout checks failed</Chip>}
        {fc?.passed ? <Chip tone="ok" icon={<CheckCircle2 size={12} aria-hidden />}>Fact check passed</Chip> : <Chip tone="bad" icon={<XCircle size={12} aria-hidden />}>Fact check failed</Chip>}
        {qa && <span className="tnum text-xs text-muted">{qa.pages} page{qa.pages === 1 ? '' : 's'} · {qa.fontSize}pt</span>}
        <button className="ml-auto text-xs font-medium text-primary hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Export checks'}</button>
      </div>
      {open && qa && <ul className="anim-fade mt-2 space-y-1 text-sm" data-testid="qa-list">{qa.checks.map((c: any) => <li key={c.id} className="flex items-start gap-2">{c.status === 'pass' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" aria-label="Passed" /> : c.status === 'warn' ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-label="Warning" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-bad" aria-label="Failed" />}<span><span className="font-medium">{c.label}.</span> <span className="text-muted">{c.detail}</span></span></li>)}
        <li className="pt-1 text-xs text-muted">These checks confirm the file is readable text with standard headings. No tool can guarantee how a specific ATS will rank you.</li></ul>}
    </div>
  )
}
