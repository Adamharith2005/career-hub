import { useMemo, useState } from 'react'
import { AlertCircle, CalendarClock, Columns3, FileCheck2, Plus, Search, Table2 } from 'lucide-react'
import { api, errMsg, fmtDate, READY, REC, STATUS_TONE } from './api'
import { roleName, useApp } from './ctx'
import { Button, Chip, Empty, Field, Input, Modal, Select, Spinner, Textarea, Toggle, cx, useAsync, useToast } from './ui'

// ---------------------------------------------------------------- shared bits
export const StatusChip = ({ status, label }: { status: string; label: string }) => <Chip tone={STATUS_TONE[status]}>{label}</Chip>

export function FitBadge({ score, rec, confidence }: { score: number | null; rec?: string | null; confidence?: string | null }) {
  if (score == null) return <span className="text-sm text-faint" title="No confirmed facts to compare yet">—</span>
  const r = rec ? REC[rec] : null
  return <Chip tone={r?.tone ?? 'neutral'} title={`Explainable heuristic, not an ATS score${confidence ? ` · ${confidence.toLowerCase()} confidence` : ''}`} icon={<span aria-hidden>{r?.icon}</span>}><span className="tnum">{score}</span>{r && <span className="sr-only"> {r.label}</span>}</Chip>
}

const PRE = ['DISCOVERED', 'SAVED', 'PREPARING', 'READY_TO_APPLY']
const POST = ['SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'ACCEPTED']
export function validTargets(status: string, applied: boolean, all: string[]) {
  return all.filter((s) => s !== status && s !== 'APPLIED' && !(PRE.includes(s) && applied) && !(POST.includes(s) && !applied) && !(s === 'ACCEPTED' && status !== 'OFFER') && !(s === 'REJECTED' && !applied))
}

export function MarkAppliedModal({ appId, onClose, onDone }: { appId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [method, setMethod] = useState('Email')
  const [other, setOther] = useState('')
  const [note, setNote] = useState('')
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { await api('app.markApplied', { id: appId, confirmed: sure, date, method: method === 'Other' ? other : method, note }); toast('ok', 'Marked as applied. A follow-up reminder was set.'); onDone(); onClose() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Modal title="Mark as applied" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!sure} onClick={submit}>Mark as applied</Button></>}>
      <p className="mb-4 text-sm text-muted">Career Hub never submits anything for you. Record this only after you have actually sent the application.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date you applied">{(id) => <Input id={id} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="How did you apply?">{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>{['Email', 'Careers portal', 'Job board', 'LinkedIn', 'In person', 'Other'].map((m) => <option key={m}>{m}</option>)}</Select>}</Field>
      </div>
      {method === 'Other' && <Field className="mt-3" label="Method">{(id) => <Input id={id} value={other} onChange={(e) => setOther(e.target.value)} />}</Field>}
      <Field className="mt-3" label="Note (optional)">{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <div className="mt-4"><Toggle on={sure} onClick={() => setSure(!sure)}>I confirm I submitted this application on the date above</Toggle></div>
    </Modal>
  )
}

// ---------------------------------------------------------------- list / board
const FILTERS = [['ALL', 'All'], ['TO_APPLY', 'To apply'], ['ACTIVE', 'Active'], ['INTERVIEW', 'Interview'], ['OFFER', 'Offer'], ['CLOSED', 'Closed']] as const
const COLS = [
  { key: 'to_apply', label: 'To apply', statuses: PRE },
  { key: 'applied', label: 'Applied', statuses: ['APPLIED'] },
  { key: 'screening', label: 'Screening', statuses: ['SCREENING', 'ASSESSMENT'] },
  { key: 'interview', label: 'Interview', statuses: ['INTERVIEW'] },
  { key: 'offer', label: 'Offer', statuses: ['OFFER', 'ACCEPTED'] },
  { key: 'closed', label: 'Closed', statuses: ['REJECTED', 'WITHDRAWN', 'NOT_PURSUED'] },
]

function ApplicationsView({ limit, showBoard }: { limit?: number; showBoard?: boolean }) {
  const { boot, openApp, newApp, tick, refresh } = useApp()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<string>('ALL')
  const [view, setView] = useState<'table' | 'board'>('table')
  const [mark, setMark] = useState<string | null>(null)
  const [closing, setClosing] = useState<any>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const list = useAsync(() => api('app.list', { q, filter }), [q, filter, tick])
  const label = useMemo(() => Object.fromEntries(boot.statuses.map((s) => [s.key, s.label])), [boot.statuses])
  const allStatuses = boot.statuses.map((s) => s.key)
  const rows: any[] = (list.data ?? []).slice(0, limit)

  const setStatus = async (a: any, status: string, note?: string) => {
    try { await api('app.setStatus', { id: a.application_id, status, note }); await refresh() } catch (e) { toast('bad', errMsg(e)) }
  }
  const drop = async (colKey: string, id: string) => {
    setDragOver(null)
    const a = (list.data ?? []).find((x: any) => x.application_id === id); if (!a) return
    const col = COLS.find((c) => c.key === colKey)!
    if (col.statuses.includes(a.status)) return
    if (colKey === 'applied') { if (a.applied_at) return toast('warn', 'Already submitted — drag it to a later stage.'); return setMark(id) }
    if (colKey === 'closed') return setClosing(a)
    const target = colKey === 'to_apply' ? 'SAVED' : col.statuses[0]
    await setStatus(a, target)
  }
  const empty = !list.loading && (list.data ?? []).length === 0

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden /><Input aria-label="Search applications" placeholder="Search company or role" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by stage">
          {FILTERS.map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)} className={cx('rounded-full border px-3 py-1 text-[13px] transition-colors duration-150', filter === k ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line bg-surface text-muted hover:bg-surface2')}>{l}</button>)}
        </div>
        {showBoard && <div className="ml-auto flex rounded-lg border border-line-strong bg-surface p-0.5" role="group" aria-label="View">
          <button aria-pressed={view === 'table'} onClick={() => setView('table')} className={cx('flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px]', view === 'table' ? 'bg-surface2 font-medium' : 'text-muted')}><Table2 size={14} aria-hidden />Table</button>
          <button aria-pressed={view === 'board'} onClick={() => setView('board')} className={cx('flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px]', view === 'board' ? 'bg-surface2 font-medium' : 'text-muted')}><Columns3 size={14} aria-hidden />Board</button>
        </div>}
      </div>

      {list.loading && !list.data ? <Spinner /> : empty ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface"><Empty title={q || filter !== 'ALL' ? 'Nothing matches' : 'No applications yet'} icon={<FileCheck2 size={20} aria-hidden />} action={!q && filter === 'ALL' ? <Button variant="primary" onClick={() => newApp()} icon={<Plus size={15} aria-hidden />}>Add your first job</Button> : undefined}>
          {q || filter !== 'ALL' ? 'Try another search or filter.' : 'Paste a job description, or pick a Cyberjaya company. You’ll get an honest match and tailored documents.'}</Empty></div>
      ) : view === 'table' || !showBoard ? (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_1fr_.7fr_.9fr_1.5fr_1fr] gap-3 border-b border-line bg-surface2/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted lg:grid" role="row">
            <span>Company & role</span><span>Status</span><span>Fit</span><span>Date</span><span>Next step</span><span>Documents</span>
          </div>
          <ul>
            {rows.map((a) => {
              const overdue = a.next_action_due && a.next_action_due <= new Date().toISOString().slice(0, 10)
              return (
                <li key={a.application_id} className="border-b border-line last:border-0">
                  <button onClick={() => openApp(a.application_id)} className="grid w-full grid-cols-1 items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface2/60 lg:grid-cols-[minmax(0,2.2fr)_1fr_.7fr_.9fr_1.5fr_1fr]">
                    <span className="min-w-0"><span className="block truncate font-medium">{a.company_name}</span><span className="block truncate text-sm text-muted">{a.role_title}{a.mode === 'SPECULATIVE_OUTREACH' && <span className="ml-1.5 text-xs text-faint">· speculative</span>}</span></span>
                    <span className="flex flex-wrap items-center gap-1.5"><StatusChip status={a.status} label={label[a.status]} /></span>
                    <span><FitBadge score={a.fit_score} rec={a.recommendation} confidence={a.confidence} /></span>
                    <span className="tnum text-sm text-muted">{a.applied_at ? fmtDate(a.applied_at) : <span className="text-faint">Not applied</span>}</span>
                    <span className="min-w-0 truncate text-sm">{a.next_action_text ? <span className={cx('inline-flex items-center gap-1', overdue && 'font-medium text-bad')}>{overdue && <AlertCircle size={13} aria-label="Overdue" />}{a.next_action_text}<span className="tnum text-xs text-muted"> · {fmtDate(a.next_action_due)}</span></span> : <span className="text-faint">—</span>}</span>
                    <span><Chip tone={READY[a.readiness].tone}>{READY[a.readiness].label}</Chip></span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div className="scroll-thin -mx-1 grid auto-cols-[minmax(178px,1fr)] grid-flow-col gap-3 overflow-x-auto px-1 pb-3" aria-label="Application board">
          {COLS.map((c) => {
            const items = rows.filter((a) => c.statuses.includes(a.status))
            return (
              <section key={c.key} aria-label={c.label} data-col={c.key} onDragOver={(e) => { e.preventDefault(); setDragOver(c.key) }} onDragLeave={() => setDragOver(null)} onDrop={(e) => { e.preventDefault(); void drop(c.key, e.dataTransfer.getData('text/plain')) }}
                className={cx('min-w-0 rounded-xl border bg-surface2/50 p-2 transition-colors duration-150', dragOver === c.key ? 'border-primary bg-primary-soft/50' : 'border-line')}>
                <h3 className="mb-2 flex items-center justify-between px-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{c.label}<span className="tnum rounded-full bg-surface px-1.5 py-0.5 text-[11px]">{items.length}</span></h3>
                <ul className="space-y-2">
                  {items.map((a) => (
                    <li key={a.application_id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.application_id); e.dataTransfer.effectAllowed = 'move' }} data-card={a.application_id}
                      className="cursor-grab rounded-lg border border-line bg-surface p-2.5 shadow-[0_1px_0_rgba(0,0,0,.03)] active:cursor-grabbing">
                      <button onClick={() => openApp(a.application_id)} className="block w-full text-left"><span className="block truncate text-sm font-medium">{a.company_name}</span><span className="block truncate text-xs text-muted">{a.role_title}</span></button>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5"><FitBadge score={a.fit_score} rec={a.recommendation} /><Chip tone={READY[a.readiness].tone}>{READY[a.readiness].label}</Chip></div>
                      <Select aria-label={`Move ${a.company_name} to another stage`} className="mt-2 h-7 py-0 text-xs" value="" onChange={(e) => { if (e.target.value === 'APPLIED') setMark(a.application_id); else if (e.target.value === 'CLOSE') setClosing(a); else if (e.target.value) void setStatus(a, e.target.value) }}>
                        <option value="">Move to…</option>{!a.applied_at && <option value="APPLIED">Applied… (confirm)</option>}{validTargets(a.status, !!a.applied_at, allStatuses).filter((s) => !['REJECTED', 'WITHDRAWN', 'NOT_PURSUED'].includes(s)).map((s) => <option key={s} value={s}>{label[s]}</option>)}<option value="CLOSE">Close…</option>
                      </Select>
                    </li>
                  ))}
                  {!items.length && <li className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-xs text-faint">Drop here</li>}
                </ul>
              </section>
            )
          })}
        </div>
      )}
      {limit && (list.data?.length ?? 0) > limit && <p className="mt-2 text-sm text-muted">Showing {limit} of {list.data.length}. Open Applications for the full list.</p>}
      {mark && <MarkAppliedModal appId={mark} onClose={() => setMark(null)} onDone={refresh} />}
      {closing && <CloseModal app={closing} statuses={validTargets(closing.status, !!closing.applied_at, allStatuses).filter((s) => ['REJECTED', 'WITHDRAWN', 'NOT_PURSUED'].includes(s))} label={label} onClose={() => setClosing(null)} onPick={async (s) => { await setStatus(closing, s); setClosing(null) }} />}
    </div>
  )
}

function CloseModal({ app, statuses, label, onClose, onPick }: { app: any; statuses: string[]; label: Record<string, string>; onClose: () => void; onPick: (s: string) => void }) {
  return (
    <Modal title={`Close ${app.company_name}?`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Choose what happened. This is recorded in the timeline.</p>
      <div className="flex flex-col gap-2">{statuses.map((s) => <Button key={s} onClick={() => onPick(s)} className="justify-start">{label[s]}</Button>)}</div>
    </Modal>
  )
}

// ---------------------------------------------------------------- pages
export function ApplicationsPage() {
  const { newApp } = useApp()
  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Applications</h1><p className="mt-1 text-muted">Everything you’ve saved, prepared and sent.</p></div><Button variant="primary" onClick={() => newApp()} icon={<Plus size={15} aria-hidden />}>New application</Button></header>
      <ApplicationsView showBoard />
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return <div className="rounded-xl border border-line bg-surface px-4 py-3.5"><p className="text-[13px] text-muted">{label}</p><p className="tnum mt-0.5 text-[28px] font-semibold leading-tight tracking-tight">{value}</p>{hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}</div>
}

export function HomePage() {
  const { boot, newApp, openApp, tick, go } = useApp()
  const m = useAsync(() => api('metrics'), [tick])
  const p = boot.profile
  const d = m.data
  const hour = new Date().getHours()
  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, {p.name.split(' ')[0]}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted"><span>Focus:</span>{p.roles.map((r: string) => <Chip key={r} tone={r === p.primary_role ? 'info' : 'neutral'}>{roleName(boot, r)}</Chip>)}<span>·</span><span>{p.career_types.map((t: string) => (t === 'INTERNSHIP' ? 'Internship' : 'Graduate')).join(' & ')} · {p.region}</span></div>
        </div>
        <Button variant="primary" onClick={() => newApp()} icon={<Plus size={15} aria-hidden />}>Add job</Button>
      </header>

      {d && (
        <>
          <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Submitted" value={d.submitted} hint="Confirmed by you" /><Metric label="Active" value={d.active} hint="Submitted, still open" /><Metric label="Interviewing" value={d.interviewing} /><Metric label="Offers" value={d.offers} />
          </section>
          <p className="mt-2.5 text-sm text-muted tnum" data-testid="secondary-metrics">{d.drafts} in preparation · Response rate {d.responseRate == null ? '—' : `${Math.round(d.responseRate * 100)}%`}{d.responseRate == null && <span className="text-faint"> (needs a submitted application)</span>} · {d.followUpsDue} follow-up{d.followUpsDue === 1 ? '' : 's'} due</p>
          {d.nextUp.length > 0 && (
            <section aria-label="Next up" className="mt-5 flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center">
              <span className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock size={16} className="text-primary" aria-hidden />Next up</span>
              <div className="flex flex-1 flex-wrap gap-2">{d.nextUp.slice(0, 3).map((n: any) => <button key={n.application_id} onClick={() => openApp(n.application_id, 'timeline')} className={cx('rounded-lg border px-2.5 py-1 text-left text-sm hover:bg-surface2', n.overdue ? 'border-bad/40 text-bad' : 'border-line')}>{n.overdue && <span className="font-semibold">Overdue · </span>}{n.company_name} — {n.next_action_text} <span className="tnum text-xs opacity-80">{fmtDate(n.next_action_due)}</span></button>)}</div>
            </section>
          )}
        </>
      )}

      <section className="mt-7"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Recent applications</h2><button onClick={() => go('applications')} className="text-sm font-medium text-primary hover:underline">View all & board</button></div><ApplicationsView limit={8} /></section>
    </div>
  )
}
