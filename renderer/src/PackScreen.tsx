import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Copy, Download, ExternalLink, Eye, FileArchive, FileText, Info, Loader2, Mail, RefreshCw, X } from 'lucide-react'
import { api, errMsg } from './api'
import { roleName, useApp, type PrepareOpts } from './ctx'
import { Disclosure, SavedIndicator, useAutosave } from './kit'
import { PdfPreview, PdfThumb } from './PdfPreview'
import { Banner, Button, Chip, Field, Input, Modal, Textarea, cx, useToast } from './ui'

const ROLE_NOUN: Record<string, string> = { swe: 'Software Engineering', frontend: 'Frontend', backend: 'Backend', ai_ml: 'AI / Machine Learning', data: 'Data Analytics', cyber: 'Cybersecurity', cloud_devops: 'Cloud / DevOps', qa: 'QA / Testing', it_support: 'IT Support', other: 'Technology' }

async function copyToClipboard(text: string) {
  try { await api('clipboard.copy', { text }); return true } catch { /* fall through to the browser API */ }
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

/** Small copy control that confirms honestly: it only says "Copied" after the clipboard call actually succeeded. */
function CopyButton({ text, label, size = 'sm', variant = 'secondary', children }: { text: string; label: string; size?: 'sm' | 'md'; variant?: 'secondary' | 'ghost' | 'primary'; children?: React.ReactNode }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  const t = useRef<number>(0)
  useEffect(() => () => window.clearTimeout(t.current), [])
  return (
    <Button size={size} variant={variant} aria-label={`Copy ${label}`} data-testid={`copy-${label.toLowerCase().replace(/\W+/g, '-')}`} disabled={!text}
      onClick={async () => { const ok = await copyToClipboard(text); if (ok) { setDone(true); window.clearTimeout(t.current); t.current = window.setTimeout(() => setDone(false), 1600); toast('ok', `${label} copied`) } else toast('bad', 'Copy was blocked by the system. Select the text and copy it manually.') }}
      icon={done ? <Check size={14} className="text-ok" aria-hidden /> : <Copy size={14} aria-hidden />}>{children ?? (done ? 'Copied' : 'Copy')}</Button>
  )
}

function Section({ n, title, aside, children, className }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cx('card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold"><span className="grid h-5 w-5 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary" aria-hidden>{n}</span>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** One screen, five outputs: email address, subject, wording, resume.pdf, cv.pdf. Drafts only: nothing is sent, nothing is marked Applied. */
export function PackScreen({ opts, onClose }: { opts: PrepareOpts; onClose: () => void }) {
  const { boot, refresh, go } = useApp()
  const toast = useToast()
  const me = boot.profile
  const [company, setCompany] = useState<any>(null)
  const [family, setFamily] = useState<string>('')
  const [title, setTitle] = useState('')
  const [jobText, setJobText] = useState('')
  const [pack, setPack] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [issues, setIssues] = useState<any[] | null>(null)
  const [view, setView] = useState<null | 'resume' | 'cv'>(null)
  const started = useRef(false)

  const generate = useCallback(async (o: { family: string; title: string; jobText: string; resetEmail?: boolean; appId?: string }) => {
    setBusy(true); setErr(null); setIssues(null)
    try {
      const r = await api('pack.prepare', { companyId: opts.companyId, roleFamily: o.family, title: o.title, jobText: o.jobText || undefined, resetEmail: o.resetEmail, appId: o.appId })
      if (!r.ok) { setIssues(r.issues); setPack(null) } else { setPack(r); await refresh() }
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }, [opts.companyId, refresh])

  // Open: show the saved pack for this company if there is one; otherwise prepare one straight away for the best-fitting role.
  useEffect(() => {
    if (started.current) return; started.current = true
    ;(async () => {
      try {
        const c = await api('companies.get', { id: opts.companyId, focusRoles: opts.focusRoles }); setCompany(c)
        const fams: string[] = (c.role_families as string[]).filter((r) => r !== 'other')
        const mine = ((opts.focusRoles?.length ? opts.focusRoles : me.roles) as string[])
        // Best role is one the person actually holds: the company's best-matching role from the fit estimate, else their first role the company lists, else their primary role.
        const best = c.fit?.matchedRoles?.find((m: any) => mine.includes(m.role))?.role as string | undefined
        const pick = best ?? mine.find((r) => fams.includes(r)) ?? me.primary_role ?? mine[0] ?? fams[0] ?? 'swe'
        const existing = await api('pack.forCompany', { companyId: opts.companyId })
        if (existing) { setPack(existing); setFamily(existing.app.role_family); setTitle(existing.app.role_title); return }
        const t = `${ROLE_NOUN[pick] ?? 'Technology'} Intern`
        setFamily(pick); setTitle(t)
        await generate({ family: pick, title: t, jobText: '' })
      } catch (e) { setErr(errMsg(e)) }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const roleOptions = useMemo(() => {
    const fams: string[] = ((company?.role_families ?? []) as string[]).filter((r) => r !== 'other')
    const mine = (me.roles as string[]).filter((r) => r !== 'other')
    return [...new Set([...mine.filter((r) => fams.includes(r)), ...fams, ...mine])]
  }, [company, me.roles])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !view) onClose() }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [view, onClose])
  const switchRole = (f: string) => { const t = `${ROLE_NOUN[f] ?? 'Technology'} Intern`; setFamily(f); setTitle(t); void generate({ family: f, title: t, jobText }) }

  return (
    <div role="dialog" aria-modal="true" aria-label="Application pack" className="anim-fade fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="shrink-0 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center gap-x-4 gap-y-2">
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Back to companies" icon={<ArrowLeft size={15} aria-hidden />}>Companies</Button>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Application pack · draft only</p>
            <h1 className="font-display truncate text-xl font-semibold leading-tight" data-testid="pack-title">{company?.name ?? 'Preparing…'}{pack && <span className="font-normal text-muted"> — {pack.app.role_title}</span>}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="pack-meta">
            <Chip tone="info" title="Every fact in this pack comes from this profile only">Profile: {me.name}</Chip>
            {pack && <Chip>v{String(pack.version).padStart(2, '0')}</Chip>}
            {pack && <Chip tone={pack.app.status === 'READY_TO_APPLY' ? 'ok' : 'neutral'} icon={pack.app.status === 'READY_TO_APPLY' ? <Check size={11} aria-hidden /> : undefined}>{pack.app.statusLabel}</Chip>}
            <span className="text-xs text-muted">Nothing has been sent</span>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close" icon={<X size={16} aria-hidden />} className="!px-2" />
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1360px] space-y-4 px-4 py-4 sm:px-6">
          <RolePicker options={roleOptions} family={family} title={title} jobText={jobText} setTitle={setTitle} setJobText={setJobText} onFamily={switchRole} busy={busy} boot={boot}
            onRegenerate={() => generate({ family, title, jobText })} hasPack={!!pack} />

          {err && <Banner tone="bad" title="Couldn’t prepare the pack">{err}</Banner>}
          {issues && <Banner tone="warn" title="Blocked to protect you from unsupported claims"><ul className="mt-1 list-disc pl-5">{issues.slice(0, 5).map((i: any, k: number) => <li key={k}>{i.message}</li>)}</ul></Banner>}

          {busy && !pack && <Skeleton />}
          {pack && (
            <div className={cx('transition-opacity duration-200', busy && 'opacity-60')} aria-busy={busy}>
              <PackBody pack={pack} setPack={setPack} onView={setView} onRegenerate={(reset?: boolean) => generate({ family, title, jobText, resetEmail: reset, appId: pack.app.application_id })} busy={busy} onApplications={() => { onClose(); go('applications') }} />
            </div>
          )}
        </div>
      </div>
      {view && pack && <DocViewer pack={pack} which={view} onClose={() => setView(null)} />}
    </div>
  )
}

function Skeleton() {
  const bar = 'animate-pulse rounded bg-surface3'
  return (
    <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" role="status" aria-label="Preparing your pack">
      <div className="card space-y-3 p-4"><div className={cx(bar, 'h-4 w-1/3')} /><div className={cx(bar, 'h-9')} /><div className={cx(bar, 'h-9')} /><div className={cx(bar, 'h-56')} /></div>
      <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <div key={i} className="card space-y-3 p-4"><div className={cx(bar, 'h-4 w-1/2')} /><div className={cx(bar, 'aspect-[210/297] w-full')} /><div className={cx(bar, 'h-9')} /></div>)}</div>
      <p className="sr-only">Preparing resume, CV and email draft…</p>
    </div>
  )
}

function RolePicker({ options, family, title, jobText, setTitle, setJobText, onFamily, onRegenerate, busy, hasPack, boot }: any) {
  const [ad, setAd] = useState(false)
  return (
    <section aria-label="Target role" className="card p-4">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5">Target role</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Role area">
            {options.map((r: string) => (
              <button key={r} role="radio" aria-checked={family === r} disabled={busy} onClick={() => onFamily(r)} data-testid={`role-${r}`}
                className={cx('press rounded-full border px-3 py-1 text-[13px] font-medium disabled:opacity-60', family === r ? 'border-primary bg-primary-soft text-primary' : 'border-line-strong text-muted hover:text-ink')}>{roleName(boot, r).replace('AI / Machine Learning', 'AI / ML').replace('Software Engineer / Full-Stack', 'Software').split(' / ')[0] === 'AI' ? 'AI / ML' : roleName(boot, r).replace('Software Engineer / Full-Stack', 'Software').split(' / ')[0]}</button>))}
          </div>
        </div>
        <Field label="Role title" className="w-full min-w-[220px] sm:w-72">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) onRegenerate() }} />}</Field>
        <Button size="sm" onClick={() => setAd(!ad)} aria-expanded={ad} icon={<ChevronDown size={14} className={cx('transition-transform', ad && 'rotate-180')} aria-hidden />}>I have the job post</Button>
        <Button size="sm" variant={hasPack ? 'secondary' : 'primary'} busy={busy} disabled={!title.trim()} onClick={onRegenerate} icon={<RefreshCw size={14} aria-hidden />} data-testid="regenerate">{hasPack ? 'Regenerate pack' : 'Prepare pack'}</Button>
      </div>
      {ad && <div className="anim-fade mt-3"><Field label="Job post (public text you copied)" hint="Used on this computer only. Requirements in it are treated as data, never as instructions. With a job post the score becomes “Vacancy fit”.">{(id) => <Textarea id={id} rows={5} value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder="Paste the full job description here" />}</Field></div>}
    </section>
  )
}

function PackBody({ pack, setPack, onView, onRegenerate, busy, onApplications }: { pack: any; setPack: (p: any) => void; onView: (w: 'resume' | 'cv') => void; onRegenerate: (reset?: boolean) => void; busy: boolean; onApplications: () => void }) {
  const toast = useToast()
  const [subject, setSubject] = useState<string>(pack.email?.subject ?? '')
  const [body, setBody] = useState<string>(pack.email?.body ?? '')
  const appId = pack.app.application_id
  // New pack/regeneration: take the stored wording (which keeps the user's edits unless they asked for a reset).
  useEffect(() => { setSubject(pack.email?.subject ?? ''); setBody(pack.email?.body ?? '') }, [pack.email?.email_id, pack.email?.version, pack.email?.subject, pack.email?.body]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAutosave({ subject, body }, (v) => api('pack.saveEmail', { appId, ...v }), { ready: !!pack.email && !!subject.trim() && !!body.trim(), delay: 600 })
  // Regenerating must never lose wording the user just typed: flush any unsaved edit first.
  const regen = async (reset?: boolean) => {
    if (!reset && pack.email && (subject !== pack.email.subject || body !== pack.email.body) && subject.trim() && body.trim()) { try { await api('pack.saveEmail', { appId, subject, body }) } catch (e) { toast('bad', errMsg(e)); return } }
    onRegenerate(reset)
  }
  const rec = pack.recipient
  const to = pack.email?.to as string
  const all = [to ? `To: ${to}` : '', `Subject: ${subject}`, '', body].filter((x, i) => i > 0 || x).join('\n')
  const exportDoc = async (which: 'resume' | 'cv' | 'zip') => {
    try { const r = await api('pack.export', { appId, which }); toast('ok', `Saved ${which === 'zip' ? 'application-pack.zip' : `${which}.pdf`} to ${r.path}`) } catch (e) { toast('bad', errMsg(e)) }
  }
  const words = body.split(/\nKind regards,/)[0].trim().split(/\s+/).filter(Boolean).length
  const lintErrors = (pack.lint ?? []).filter((l: any) => l.severity === 'error')

  return (
    <div className="grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ---------------- email: outputs 1-3 */}
      <div className="space-y-4">
        <Section n={1} title="Company email" aside={to ? <CopyButton text={to} label="Email address" /> : undefined}>
          {to ? (
            <div data-testid="out-email">
              <p className="break-all text-[15px] font-medium">{to}</p>
              <p className="mt-1 flex items-start gap-1.5 text-xs text-muted"><Info size={12} className="mt-0.5 shrink-0" aria-hidden />{rec?.label}. Taken from company research, not guessed. Check it on the company’s own site before sending.</p>
            </div>
          ) : (
            <div data-testid="out-email" className="space-y-2">
              <p className="flex items-center gap-1.5 text-[15px] font-medium"><AlertTriangle size={15} className="text-warn" aria-hidden />No verified public email</p>
              <p className="text-sm text-muted">Apply through the official route instead. The wording below is an optional enquiry, with no recipient made up.</p>
              {rec?.careersUrl ? <button onClick={() => api('link.open', { url: rec.careersUrl }).catch((e) => toast('bad', errMsg(e)))} className="inline-flex max-w-full items-center gap-1 break-all text-left text-sm font-medium text-primary hover:underline" data-testid="careers-link"><ExternalLink size={13} className="shrink-0" aria-hidden />{rec.careersUrl}</button>
                : rec?.websiteUrl ? <p className="text-sm text-muted">No careers page recorded. Company website: <span className="break-all">{rec.websiteUrl}</span></p> : <p className="text-sm text-muted">No careers page or website is recorded for this company.</p>}
              <Disclosure summary="Application instructions"><pre className="whitespace-pre-wrap rounded-lg bg-surface2 p-3 text-[13px] leading-relaxed" data-testid="instructions">{rec?.instructions}</pre><div className="mt-2"><CopyButton text={rec?.instructions ?? ''} label="Application instructions" /></div></Disclosure>
            </div>
          )}
        </Section>

        <Section n={2} title="Subject" aside={<CopyButton text={subject} label="Subject" />}>
          <Input aria-label="Email subject" data-testid="out-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Section>

        <Section n={3} title="Email wording" aside={<div className="flex items-center gap-2"><SavedIndicator state={save.state} error={save.error} /><CopyButton text={body} label="Email wording" /></div>}>
          <Textarea aria-label="Email wording" data-testid="out-body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} className="leading-relaxed" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="tnum">{words} words{words < 110 || words > 180 ? ' · aim for 110–180' : ''}</span>
            {pack.email?.edited && <span>Edited by you · kept when you regenerate</span>}
            <span className="flex-1" />
            {pack.email?.edited && <button onClick={() => regen(true)} className="font-medium text-primary hover:underline">Reset wording</button>}
          </div>
          {lintErrors.map((l: any) => <p key={l.message} className="mt-2 flex items-start gap-1.5 text-xs text-bad" role="alert"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{l.message}</p>)}
          {(pack.lint ?? []).filter((l: any) => l.severity === 'warn').slice(0, 2).map((l: any) => <p key={l.message} className="mt-1 text-xs text-warn">{l.message}</p>)}
          <p className="mt-2 text-xs text-muted">Documents are mentioned as attached only as a drafting note: attach <strong className="font-medium text-ink">resume.pdf</strong> and <strong className="font-medium text-ink">cv.pdf</strong> yourself. Career Hub never sends or attaches anything.</p>
          <div className="mt-3"><CopyButton text={all} label="Everything" variant="primary" size="md">Copy all</CopyButton></div>
        </Section>
      </div>

      {/* ---------------- documents: outputs 4-5, then honesty panel */}
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <DocCard n={4} kind="resume" title="Resume — concise" sub="One A4 page, ATS-safe" doc={pack.docs.resume} onView={() => onView('resume')} onDownload={() => exportDoc('resume')} />
          <DocCard n={5} kind="cv" title="CV — detailed" sub="Fuller coverage, ATS-safe" doc={pack.docs.cv} onView={() => onView('cv')} onDownload={() => exportDoc('cv')} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => exportDoc('zip')} icon={<FileArchive size={15} aria-hidden />} data-testid="download-all">Download all (.zip)</Button>
          <Button onClick={() => regen(false)} busy={busy} icon={<RefreshCw size={15} aria-hidden />}>Regenerate documents</Button>
          <Button variant="ghost" onClick={onApplications}>My applications</Button>
          <span className="text-xs text-muted">The zip holds resume.pdf, cv.pdf and a notes file.</span>
        </div>
        <Alignment a={pack.alignment} />
        {pack.needs?.length > 0 && (
          <section aria-label="Confirm before sending" className="card p-4" data-testid="needs-confirm">
            <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold"><AlertTriangle size={14} className="text-warn" aria-hidden />Check before you send</h3>
            <p className="mb-2 text-xs text-muted">These items are in your documents but are still flagged in your profile.</p>
            <ul className="space-y-1.5 text-sm">{pack.needs.map((n: any) => <li key={n.factId}><span className="font-medium">{n.title}</span><span className="text-muted"> — {n.why}</span></li>)}</ul>
          </section>
        )}
        {pack.notes?.length > 0 && <Banner tone="info">{pack.notes.join(' ')}</Banner>}
      </div>
    </div>
  )
}

function DocCard({ n, kind, title, sub, doc, onView, onDownload }: { n: number; kind: 'resume' | 'cv'; title: string; sub: string; doc: any; onView: () => void; onDownload: () => void }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setBytes(null); setErr(null); if (doc) api('docs.pdfBytes', { docId: doc.doc_id }).then(setBytes).catch((e) => setErr(errMsg(e))) }, [doc?.doc_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const failed = doc?.qa?.checks?.filter((c: any) => c.status === 'fail') ?? []
  const warns = doc?.qa?.checks?.filter((c: any) => c.status === 'warn') ?? []
  return (
    <section aria-label={title} className="card p-4" data-testid={`out-${kind}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div><h3 className="flex items-center gap-2 text-[13px] font-semibold"><span className="grid h-5 w-5 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary" aria-hidden>{n}</span>{title}</h3><p className="mt-0.5 text-xs text-muted">{sub}</p></div>
        {doc && <Chip tone={failed.length ? 'bad' : warns.length ? 'warn' : 'ok'} icon={failed.length ? <AlertTriangle size={11} aria-hidden /> : <Check size={11} aria-hidden />}>{doc.pages} page{doc.pages === 1 ? '' : 's'}</Chip>}
      </div>
      <button onClick={onView} aria-label={`View ${kind}.pdf`} disabled={!doc} className="press block w-full rounded-md focus-visible:outline-offset-4" data-testid={`view-${kind}`}>
        {err ? <p role="alert" className="grid aspect-[210/297] place-items-center rounded-md bg-surface2 p-3 text-center text-xs text-bad">{err}</p> : <PdfThumb bytes={bytes} label={`${title} preview`} />}
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onView} disabled={!doc} icon={<Eye size={14} aria-hidden />}>View</Button>
        <Button size="sm" variant="primary" onClick={onDownload} disabled={!doc || doc.pdfState !== 'ok'} icon={<Download size={14} aria-hidden />} data-testid={`download-${kind}`}>Download {kind}.pdf</Button>
      </div>
      {doc && <p className="mt-2 text-xs text-muted">{failed.length ? <span className="text-bad">{failed[0].label}: {failed[0].detail}</span> : warns.length ? <span className="text-warn">{warns[0].label}: {warns[0].detail}</span> : `All ${doc.qa.checks.length} export checks passed`}. v{String(doc.version).padStart(2, '0')}</p>}
    </section>
  )
}

function Alignment({ a }: { a: any }) {
  if (!a) return null
  const color = a.band === 'green' ? 'var(--ok)' : a.band === 'amber' ? 'var(--warn)' : 'var(--faint)'
  const [w, setW] = useState(0)
  useEffect(() => { const id = requestAnimationFrame(() => setW(a.post ?? 0)); return () => cancelAnimationFrame(id) }, [a.post])
  const same = a.pre != null && a.post != null && a.pre === a.post
  return (
    <section aria-label={a.label} className="card p-4" data-testid="alignment" data-band={a.band}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold">{a.label}</h3>
          <p className="mt-0.5 text-xs text-muted">{a.verdict}</p>
        </div>
        <Chip tone={a.confidence === 'High' ? 'ok' : a.confidence === 'Medium' ? 'info' : 'warn'} title={a.confidenceReasons.join(' ')}>Confidence: {a.confidence}</Chip>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <span className="tnum font-display text-4xl font-semibold leading-none" style={{ color }} data-testid="alignment-score" aria-label={a.post == null ? 'Not estimated' : `${a.post} out of 100`}>{a.post ?? '–'}</span>
        <div className="min-w-0 flex-1">
          <div className="relative h-2 overflow-hidden rounded-full bg-surface3" aria-hidden>
            <div className="bar-fill h-full rounded-full" style={{ width: `${w}%`, background: color }} />
            <span className="absolute inset-y-0 w-px bg-ink/50" style={{ left: '80%' }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-faint"><span>0</span><span style={{ marginLeft: '60%' }}>80 = green</span><span>100</span></div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted tnum" data-testid="alignment-delta">
        {a.pre == null ? '' : same ? `Before tailoring ${a.pre}, after ${a.post}: tailoring did not change the number, because the resume already led with your most relevant work.` : `Before tailoring ${a.pre} → after ${a.post}. This change comes only from which of your real evidence is shown.`}
      </p>
      <div className="mt-3 space-y-1.5">
        <Disclosure summary="Why this number">
          <ul className="space-y-1 text-sm">{a.reasons.map((r: string, i: number) => <li key={i} className="flex gap-2"><span className="text-faint" aria-hidden>•</span><span>{r}</span></li>)}</ul>
          <p className="mt-3 eyebrow">What tailoring changed</p>
          <ul className="mt-1 space-y-1 text-sm text-muted">{a.changes.map((r: string, i: number) => <li key={i}>• {r}</li>)}</ul>
          <p className="mt-3 eyebrow">Confidence</p>
          <ul className="mt-1 space-y-1 text-sm text-muted">{a.confidenceReasons.map((r: string, i: number) => <li key={i}>• {r}</li>)}</ul>
          <p className="mt-3 text-xs text-muted">{a.disclaimer} Missing skills cannot be tailored away; tailoring only reorders and selects what you can already prove.</p>
        </Disclosure>
      </div>
    </section>
  )
}

function DocViewer({ pack, which, onClose }: { pack: any; which: 'resume' | 'cv'; onClose: () => void }) {
  const doc = pack.docs[which]
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  useEffect(() => { api('docs.pdfBytes', { docId: doc.doc_id }).then(setBytes).catch(() => setBytes(null)) }, [doc.doc_id])
  return (
    <Modal wide title={`${which === 'resume' ? 'Resume — concise' : 'CV — detailed'} · ${pack.profile.fullName}`} onClose={onClose}>
      <PdfPreview bytes={bytes} label={`${which}.pdf`} />
    </Modal>
  )
}
