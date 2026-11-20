import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarClock, Check, ExternalLink, FolderOpen, Mail, MessageSquareReply, NotebookPen, Send, TriangleAlert } from 'lucide-react'
import { api, errMsg, fmtDate, fmtDateTime, READY, REC, STATUS_EXPLAIN } from './api'
import { roleName, useApp } from './ctx'
import { DocumentsTab } from './Documents'
import { EmailTab } from './EmailTab'
import { FitBadge, MarkAppliedModal, StatusChip, validTargets } from './Applications'
import { Accordion, Banner, Button, Chip, Field, Input, Modal, Select, Spinner, Tabs, Textarea, cx, useAsync, useToast } from './ui'

type Tab = 'overview' | 'documents' | 'email' | 'timeline'
const COMP_LABEL: Record<string, string> = { JOB_POST: 'From the job post', UNKNOWN: 'Not verified', USER: 'Entered by you' }

export function AppDetail({ id, initialTab, onBack }: { id: string; initialTab?: string; onBack: () => void }) {
  const { boot, tick, refresh } = useApp()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? 'overview')
  const [emailKind, setEmailKind] = useState<any>(undefined)
  const [mark, setMark] = useState(false)
  const q = useAsync(() => api('app.get', { id }), [id, tick, tab])   // re-check files on disk whenever the user switches tab
  const reload = () => { q.reload(); void refresh() }
  if (!q.data) return q.error ? <Banner tone="bad" title="Couldn’t open this application">{q.error}</Banner> : <Spinner />
  const { app, company, readiness, docs } = q.data
  const label = Object.fromEntries(boot.statuses.map((s: any) => [s.key, s.label]))
  const terminal = ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'NOT_PURSUED'].includes(app.status)
  const targets = validTargets(app.status, !!app.applied_at, boot.statuses.map((s: any) => s.key))
  const a = app.assessment
  const comp = app.compensation
  const changeStatus = async (s: string) => { try { await api('app.setStatus', { id, status: s }); reload() } catch (e) { toast('bad', errMsg(e)) } }

  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} aria-hidden />Back</button>
      <header className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold tracking-tight sm:text-2xl" data-testid="app-title">{app.company_name}</h1><StatusChip status={app.status} label={label[app.status]} />{app.mode === 'SPECULATIVE_OUTREACH' && <Chip tone="neutral" title="No advertised vacancy">Speculative enquiry</Chip>}</div>
            <p className="mt-0.5 text-muted">{app.role_title} · {app.career_type === 'INTERNSHIP' ? 'Internship' : 'Graduate / Entry-level'}</p>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
              <Meta k="Location" v={app.location ?? '—'} /><Meta k="Source" v={app.source ?? '—'} />
              <Meta k={comp?.kind === 'SALARY' ? 'Salary' : 'Allowance'} v={comp?.source === 'UNKNOWN' ? <span className="text-muted">Not verified</span> : comp?.headline ?? '—'} />
              <Meta k="Next step" v={app.next_action_text ? <>{app.next_action_text} <span className="tnum text-muted">· {fmtDate(app.next_action_due)}</span></> : '—'} />
              <Meta k="Applied" v={app.applied_at ? fmtDate(app.applied_at) : <span className="text-muted">Not yet</span>} />
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {a && <FitBadge score={a.score} rec={a.recommendation} confidence={a.confidence} />}
            <Chip tone={READY[readiness].tone}>Docs: {READY[readiness].label}</Chip>
            {!terminal && <Select aria-label="Change status" className="h-9 w-auto py-1" value="" onChange={(e) => { if (e.target.value) void changeStatus(e.target.value) }}><option value="">Change status…</option>{targets.map((s: string) => <option key={s} value={s}>{label[s]}</option>)}</Select>}
            {!app.applied_at && !terminal && <Button onClick={() => setMark(true)} icon={<Send size={14} aria-hidden />}>Mark as applied</Button>}
            <Button variant="primary" onClick={() => setTab('documents')} data-testid="docs-cta">{docs.length ? 'Review documents' : 'Generate documents'}</Button>
          </div>
        </div>
      </header>

      <div className="mt-5"><Tabs label="Application sections" value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'documents', label: 'Documents' }, { key: 'email', label: 'Email' }, { key: 'timeline', label: 'Timeline' }]} /></div>
      <div key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="anim-fade pt-5">
        {tab === 'overview' && <Overview detail={q.data} reload={reload} onGenerate={() => setTab('documents')} />}
        {tab === 'documents' && <DocumentsTab detail={q.data} reload={reload} />}
        {tab === 'email' && <EmailTab detail={q.data} reload={reload} initialKind={emailKind} />}
        {tab === 'timeline' && <Timeline detail={q.data} reload={reload} onDraftFollowUp={() => { setEmailKind('FOLLOW_UP'); setTab('email') }} onMark={() => setMark(true)} />}
      </div>
      {mark && <MarkAppliedModal appId={id} onClose={() => setMark(false)} onDone={reload} />}
    </div>
  )
}

const Meta = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>

// ---------------------------------------------------------------- overview
function Overview({ detail, reload, onGenerate }: { detail: any; reload: () => void; onGenerate: () => void }) {
  const { boot } = useApp()
  const toast = useToast()
  const { app, company } = detail
  const a = app.assessment
  const rec = a ? REC[a.recommendation] : null
  const comp = app.compensation
  const [amount, setAmount] = useState('')
  const [jd, setJd] = useState(app.job_text)
  const [editJd, setEditJd] = useState(false)
  const [email, setEmail] = useState(app.contact_email ?? '')
  useEffect(() => { setJd(app.job_text); setEmail(app.contact_email ?? '') }, [app.application_id, app.job_text, app.contact_email])
  const comps = a ? [['Technical match', 'tech', 30], ['Project evidence', 'proj', 25], ['Academic fit', 'acad', 15], ['Role alignment', 'role', 15], ['Location & pay', 'locComp', 10], ['Employer channel', 'org', 5]] as const : []
  const reassess = async () => { try { await api('app.reassess', { id: app.application_id }); reload() } catch (e) { toast('bad', errMsg(e)) } }
  const openLink = (u: string) => api('link.open', { url: /^https?:/i.test(u) ? u : `https://${u}` }).catch((e) => toast('bad', errMsg(e)))

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        {a && rec ? (
          <section className="rounded-xl border border-line bg-surface p-4 sm:p-5" aria-label="Recommendation" data-testid="recommendation">
            <div className="flex flex-wrap items-center gap-3">
              <Chip tone={rec.tone} className="px-3 py-1 text-sm" icon={<span aria-hidden>{rec.icon}</span>}>{rec.label}</Chip>
              {a.score != null ? <p className="tnum text-sm"><span className="text-2xl font-semibold">{a.score}</span><span className="text-muted">/100 · match heuristic</span></p> : <p className="text-sm text-muted">No score yet — confirm your profile facts</p>}
              <Chip tone={a.confidence === 'HIGH' ? 'ok' : a.confidence === 'LOW' ? 'warn' : 'info'}>{a.confidence.charAt(0) + a.confidence.slice(1).toLowerCase()} confidence</Chip>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{a.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
            <p className="mt-3 text-xs text-muted">{a.disclaimer}</p>
            {a.score != null && a.recommendation !== 'SKIP' && !detail.docs.length && <Button className="mt-3" variant="primary" onClick={onGenerate}>Generate documents</Button>}
          </section>
        ) : <Banner tone="info" title="No analysis yet">This job was saved without a description. Add the job text below to get a match.</Banner>}

        {a?.warnings?.filter((w: any) => w.severity !== 'info').map((w: any) => <Banner key={w.code} tone={w.severity === 'high' ? 'bad' : 'warn'} title={w.severity === 'high' ? 'Warning' : undefined}>{w.text}</Banner>)}

        {a && (
          <section className="rounded-xl border border-line bg-surface px-4 sm:px-5" aria-label="Details">
            <Accordion title="Why this score — evidence, gaps and risks" defaultOpen>
              <div className="space-y-4 text-sm">
                <div><p className="mb-1.5 font-medium">Eligibility checks</p>
                  {a.gates.length ? <ul className="space-y-1.5">{a.gates.map((g: any, i: number) => <li key={i} className="flex items-start gap-2"><Chip tone={g.status === 'met' ? 'ok' : g.status === 'failed' ? 'bad' : 'warn'} className="mt-0.5 shrink-0">{g.status === 'met' ? '✓ Met' : g.status === 'failed' ? '✕ Not met' : '? Check'}</Chip><span><span className="text-muted">{g.text}</span><br />{g.note}</span></li>)}</ul> : <p className="text-muted">No mandatory requirements were detected in the ad.</p>}</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><p className="mb-1.5 font-medium">Matched with proof ({a.matched.length})</p>{a.matched.length ? <ul className="space-y-1">{a.matched.map((m: any) => <li key={m.requirement}><Chip tone="ok" icon={<Check size={11} aria-hidden />}>{m.requirement}</Chip> <span className="text-xs text-muted">in {m.titles.slice(0, 2).join(', ')}</span></li>)}</ul> : <p className="text-muted">None yet.</p>}</div>
                  <div><p className="mb-1.5 font-medium">Listed but no project proof ({a.partial.length})</p>{a.partial.length ? <div className="flex flex-wrap gap-1">{a.partial.map((m: any) => <Chip key={m.requirement} tone="info">{m.requirement}</Chip>)}</div> : <p className="text-muted">None.</p>}</div>
                </div>
                <div><p className="mb-1.5 font-medium">Gaps — in the ad, not in your facts ({a.missing.length})</p>{a.missing.length ? <div className="flex flex-wrap gap-1">{a.missing.map((m: string) => <Chip key={m} tone="warn">{m}</Chip>)}</div> : <p className="text-muted">No missing required skills.</p>}
                  <p className="mt-1.5 text-xs text-muted">Gaps are never added to your resume. If you do have one of these skills, add it in My Profile with where you used it.</p></div>
                {(a.preferredMatched.length > 0 || a.preferredMissing.length > 0) && <p><span className="font-medium">Preferred:</span> <span className="text-muted">have {a.preferredMatched.join(', ') || 'none'}; missing {a.preferredMissing.join(', ') || 'none'}</span></p>}
                {a.risks.length > 0 && <div><p className="mb-1 font-medium">Risks</p><ul className="list-disc pl-5 text-muted">{a.risks.map((r: string) => <li key={r}>{r}</li>)}</ul></div>}
                <div><p className="mb-1.5 font-medium">How the heuristic is weighted</p>
                  <ul className="space-y-1.5">{comps.map(([l, k, w]) => <li key={k} className="grid grid-cols-[130px_1fr_40px] items-center gap-2"><span className="text-muted">{l} <span className="text-faint">({w}%)</span></span><span className="h-1.5 overflow-hidden rounded-full bg-surface2"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(a.components[k] * 100)}%` }} /></span><span className="tnum text-right text-xs">{Math.round(a.components[k] * 100)}%</span></li>)}</ul>
                  {a.gateMultiplier < 1 && <p className="mt-1.5 text-xs text-warn">Unconfirmed mandatory requirement: score multiplied by {a.gateMultiplier}.</p>}</div>
                <Button size="sm" onClick={reassess}>Re-run match with my latest facts</Button>
              </div>
            </Accordion>
            <Accordion title="Job description" right={app.job_text ? <span className="text-xs font-normal text-muted">{app.job_text.length.toLocaleString()} characters</span> : <Chip tone="warn">Empty</Chip>}>
              {editJd ? <div className="space-y-2"><Textarea aria-label="Job description" rows={10} value={jd} onChange={(e) => setJd(e.target.value)} /><div className="flex gap-2"><Button size="sm" variant="primary" onClick={async () => { try { await api('app.update', { id: app.application_id, patch: { job_text: jd, spec: null } }); await api('app.reassess', { id: app.application_id }); setEditJd(false); reload() } catch (e) { toast('bad', errMsg(e)) } }}>Save & re-analyze</Button><Button size="sm" onClick={() => setEditJd(false)}>Cancel</Button></div></div>
                : <><pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface2 p-3 font-[inherit] text-[13px]">{app.job_text || 'No job text saved.'}</pre><Button size="sm" className="mt-2" onClick={() => setEditJd(true)}>Edit & re-analyze</Button></>}
            </Accordion>
          </section>
        )}
        {!a && <section className="rounded-xl border border-line bg-surface p-4"><Field label="Job description">{(fid) => <Textarea id={fid} rows={8} value={jd} onChange={(e) => setJd(e.target.value)} />}</Field><Button className="mt-2" variant="primary" disabled={jd.trim().length < 40} onClick={async () => { try { await api('app.update', { id: app.application_id, patch: { job_text: jd, spec: null } }); await api('app.reassess', { id: app.application_id }); reload() } catch (e) { toast('bad', errMsg(e)) } }}>Save & analyze</Button></section>}
      </div>

      <aside className="min-w-0 space-y-4">
        <section className="rounded-xl border border-line bg-surface p-4" aria-label="Salary or allowance" data-testid="comp-card">
          <div className="mb-1 flex items-center justify-between"><h3 className="font-semibold">{comp?.kind === 'SALARY' ? 'Salary' : 'Internship allowance'}</h3><Chip tone={comp?.source === 'UNKNOWN' ? 'warn' : 'ok'}>{COMP_LABEL[comp?.source ?? 'UNKNOWN']}</Chip></div>
          <p className="text-xl font-semibold">{comp?.headline ?? 'Not verified'}</p>
          <p className="text-xs text-muted">{comp?.source === 'UNKNOWN' ? 'The posting states no amount. Nothing is assumed.' : `Checked ${fmtDate(comp?.checkedAt)} · ${comp?.confidence === 'high' ? 'explicit in the ad' : 'entered by you'}`}</p>
          {comp?.reference && (
            <details className="mt-2 text-sm"><summary className="text-muted">Historical reference range</summary>
              <p className="mt-1.5 rounded-lg bg-surface2 p-2.5 text-xs text-muted"><strong className="text-ink">RM{comp.reference.min.toLocaleString()} – RM{comp.reference.max.toLocaleString()}/month</strong> ({comp.reference.label}). {comp.reference.note}{comp.suggestedWording && <><br /><br />If a portal asks for an expectation, this wording stays honest: “{comp.suggestedWording}”.</>}</p></details>
          )}
          <div className="mt-3 flex gap-2"><Input aria-label="Advertised amount you found" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter RM amount you verified" className="h-8 py-1 text-[13px]" /><Button size="sm" disabled={!amount.trim()} onClick={async () => { await api('app.update', { id: app.application_id, patch: { compensation: { source: 'USER', kind: comp?.kind ?? 'ALLOWANCE', headline: amount.trim(), amountText: amount.trim(), min: null, max: null, confidence: 'user', checkedAt: new Date().toISOString().slice(0, 10) } } }); setAmount(''); reload() }}>Save</Button></div>
        </section>

        <section className="rounded-xl border border-line bg-surface px-4" aria-label="Company">
          <Accordion title="Company snapshot" defaultOpen>
            {company ? (
              <div className="space-y-2 text-sm"><p className="font-medium">{company.name}</p><p className="text-muted">{company.industry} · {company.ownership_type}</p>
                <Chip tone={company.status_enum === 'VERIFIED_ACTIVE_VACANCY' ? 'ok' : 'neutral'}>{STATUS_EXPLAIN[company.status_enum]}</Chip>
                <p className="flex items-center gap-1.5 text-xs text-muted">Researched {company.last_verified ?? 'unknown'}{company.stale && <Chip tone="warn" icon={<TriangleAlert size={11} aria-hidden />}>Re-verify</Chip>}<span>· historical, not live</span></p>
                <div className="flex flex-wrap gap-2">{company.careers_page && <Button size="sm" onClick={() => openLink(company.careers_page)} icon={<ExternalLink size={13} aria-hidden />}>Careers page</Button>}{company.website && <Button size="sm" onClick={() => openLink(company.website)} icon={<ExternalLink size={13} aria-hidden />}>Website</Button>}</div></div>
            ) : <p className="text-sm text-muted">Not linked to a directory company. Contact details below are whatever you enter.</p>}
            <Field className="mt-3" label="Verified contact email" hint={company?.hr_email ? 'Pre-filled from seed research — verify it.' : 'None on record. Only enter one you have confirmed.'}>{(fid) => <Input id={fid} type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => api('app.update', { id: app.application_id, patch: { contact_email: email.trim() || null } }).catch((e) => toast('bad', errMsg(e)))} />}</Field>
          </Accordion>
        </section>
        {a?.warnings?.filter((w: any) => w.severity === 'info').length > 0 && <section className="rounded-xl border border-line bg-surface px-4"><Accordion title="Notes on data quality"><ul className="list-disc space-y-1 pl-5 text-sm text-muted">{a.warnings.filter((w: any) => w.severity === 'info').map((w: any) => <li key={w.code}>{w.text}</li>)}</ul></Accordion></section>}
        <p className="px-1 text-xs text-muted">Role family: {roleName(boot, app.role_family)}</p>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------- timeline
const EV_ICON: Record<string, string> = { CREATED: '＋', STATUS: '→', APPLIED: '✓', DOCS: '▤', EMAIL: '✉', RESPONSE: '↩', NOTE: '✎', FOLLOWUP_SET: '⏰', FOLLOWUP_DISMISSED: '⏰' }

function Timeline({ detail, reload, onDraftFollowUp, onMark }: { detail: any; reload: () => void; onDraftFollowUp: () => void; onMark: () => void }) {
  const toast = useToast()
  const { app, events } = detail
  const [note, setNote] = useState('')
  const [resp, setResp] = useState<string | null>(null)
  const [date, setDate] = useState(app.next_action_due ?? '')
  const today = new Date().toISOString().slice(0, 10)
  const overdue = app.next_action_due && app.next_action_due <= today
  const act = (fn: () => Promise<any>) => async () => { try { await fn(); reload() } catch (e) { toast('bad', errMsg(e)) } }
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section aria-label="Activity" className="min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="mb-3 font-semibold">Activity</h2>
        <ol className="relative space-y-4 border-l border-line pl-5" data-testid="timeline">
          {events.map((e: any) => (
            <li key={e.event_id} className="relative">
              <span aria-hidden className="absolute -left-[31px] grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-xs text-muted">{EV_ICON[e.event_type] ?? '•'}</span>
              <p className="text-sm">{e.event_type === 'APPLIED' ? <><strong>Applied</strong> <span className="text-muted">— confirmed by you.</span> {e.summary.replace(/^Applied /, '')}</> : e.summary}</p>
              <p className="tnum text-xs text-muted">{fmtDateTime(e.created_at)}</p>
            </li>
          ))}
        </ol>
      </section>
      <aside className="min-w-0 space-y-4">
        <section className="rounded-xl border border-line bg-surface p-4" aria-label="Next follow-up">
          <h3 className="mb-2 flex items-center gap-1.5 font-semibold"><CalendarClock size={16} className="text-primary" aria-hidden />Next follow-up</h3>
          {app.next_action_due ? (
            <>
              <p className={cx('text-sm', overdue && 'font-medium text-bad')}>{overdue && 'Overdue · '}{app.next_action_text} <span className="tnum text-muted">· {fmtDate(app.next_action_due)}</span></p>
              <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Reschedule to" className="w-40">{(fid) => <Input id={fid} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 py-1" />}</Field><Button size="sm" disabled={!date} onClick={act(() => api('app.followUp', { id: app.application_id, dueDate: date, text: app.next_action_text }))}>Save</Button><Button size="sm" variant="ghost" onClick={act(() => api('app.followUp', { id: app.application_id, dueDate: null }))}>Dismiss</Button></div>
              <Button className="mt-3 w-full" onClick={onDraftFollowUp} icon={<Mail size={14} aria-hidden />}>Draft follow-up email</Button>
            </>
          ) : (
            <div><p className="text-sm text-muted">{app.applied_at ? 'No reminder set.' : 'A reminder is set automatically when you mark this as applied.'}</p>
              {app.applied_at && <div className="mt-2 flex items-end gap-2"><Field label="Remind me on" className="w-40">{(fid) => <Input id={fid} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className="h-8 py-1" />}</Field><Button size="sm" disabled={!date} onClick={act(() => api('app.followUp', { id: app.application_id, dueDate: date, text: 'Follow up' }))}>Set</Button></div>}</div>
          )}
        </section>
        <section className="rounded-xl border border-line bg-surface p-4" aria-label="Record">
          <h3 className="mb-2 font-semibold">Record something</h3>
          <div className="flex flex-col gap-2">
            {!app.applied_at && !['REJECTED', 'WITHDRAWN', 'NOT_PURSUED', 'ACCEPTED'].includes(app.status) && <Button onClick={onMark} icon={<Send size={14} aria-hidden />}>Mark as applied…</Button>}
            {app.applied_at && <Button onClick={() => setResp('')} icon={<MessageSquareReply size={14} aria-hidden />}>Employer responded…</Button>}
          </div>
          <Field className="mt-3" label="Add a note">{(fid) => <div className="flex gap-2"><Input id={fid} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) void act(async () => { await api('app.note', { id: app.application_id, text: note }); setNote('') })() }} placeholder="Interview details, contact name…" /><Button size="sm" disabled={!note.trim()} onClick={act(async () => { await api('app.note', { id: app.application_id, text: note }); setNote('') })} icon={<NotebookPen size={14} aria-hidden />} aria-label="Add note" /></div>}</Field>
          <Button className="mt-3 w-full" size="sm" variant="ghost" onClick={() => api('fs.openAppFolder', { appId: app.application_id }).catch((e) => toast('bad', errMsg(e)))} icon={<FolderOpen size={14} aria-hidden />}>Open application folder</Button>
        </section>
      </aside>
      {resp !== null && (
        <Modal title="Employer responded" onClose={() => setResp(null)} footer={<><Button onClick={() => setResp(null)}>Cancel</Button><Button variant="primary" onClick={act(async () => { await api('app.recordResponse', { id: app.application_id, summary: resp || 'Employer responded' }); setResp(null) })}>Save</Button></>}>
          <Field label="What did they say?" hint="This counts toward your response rate. Change the status separately (Screening, Interview, Rejected…).">{(fid) => <Textarea id={fid} data-autofocus rows={3} value={resp} onChange={(e) => setResp(e.target.value)} placeholder="e.g. Recruiter asked for availability next week" />}</Field>
        </Modal>
      )}
    </div>
  )
}
