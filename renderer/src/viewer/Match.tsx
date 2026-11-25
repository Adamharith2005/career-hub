import { useEffect, useState } from 'react'
import { ChevronDown, CircleHelp, Layers } from 'lucide-react'
import { api, errMsg } from '../api'
import { Select, Spinner, cx, useToast } from '../ui'
import { Bar, MatchRing, TIER_LABEL, tierClass } from './Meter'

export interface RoleInfo { offered: { id: string; label: string }[]; all: { id: string; label: string }[]; default: string }

/** Suitability panel: the big ring, a role picker, and every criterion explained. Clicking the ring opens or closes the detail. */
export function MatchPanel({ profileId, companyId, role, onRole, onData }: { profileId: string; companyId: string; role: string | null; onRole: (r: string) => void; onData?: (m: any) => void }) {
  const toast = useToast()
  const [roles, setRoles] = useState<RoleInfo | null>(null)
  const [m, setM] = useState<any>(null)
  const [open, setOpen] = useState(true)
  useEffect(() => { let live = true; setRoles(null); api('v.match.roles', { profileId, companyId }).then((r) => { if (live) { setRoles(r); if (!role) onRole(r.default) } }).catch((e) => toast('bad', errMsg(e))); return () => { live = false } }, [profileId, companyId])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!role) return; let live = true; api('v.match.explain', { profileId, companyId, role }).then((x) => { if (live) { setM(x); onData?.(x) } }).catch((e) => toast('bad', errMsg(e))); return () => { live = false } }, [profileId, companyId, role])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!m || !roles) return <Spinner label="Working out the match" />
  const offeredIds = new Set(roles.offered.map((r) => r.id))
  return (
    <section aria-label="Suitability" className={cx('rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)]', tierClass(m.tier))} data-testid="match-panel">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${m.score} percent match for ${m.roleLabel}. ${open ? 'Hide' : 'Show'} the reasons`} className="press rounded-xl text-left" data-testid="match-toggle">
          <MatchRing key={`${profileId}-${companyId}-${role}`} score={m.score} tier={m.tier} provisional={m.provisional} size={104} />
        </button>
        <div className="min-w-[14rem] flex-1">
          <p className="text-[13px] text-muted">Company/role alignment estimate{m.provisional && <span className="ml-1.5 rounded-full bg-warn-bg px-2 py-0.5 text-[11.5px] font-semibold text-warn">Provisional: some evidence is missing</span>}</p>
          <label className="mt-2 flex items-center gap-2 text-[13px] font-semibold">Role
            <Select aria-label="Target role" data-testid="role-select" className="h-8 w-auto py-0.5 text-[13px]" value={role ?? ''} onChange={(e) => onRole(e.target.value)}>
              {roles.offered.length > 0 && <optgroup label="Work this organisation lists">{roles.offered.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</optgroup>}
              <optgroup label="Other roles">{roles.all.filter((r) => !offeredIds.has(r.id)).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</optgroup>
            </Select>
          </label>
          <p className="mt-2 text-[12.5px] leading-snug text-muted">{TIER_LABEL[m.tier]}. This describes how well the profile fits the organisation’s technical work. It is not a vacancy match, and it is not a chance of being hired.</p>
        </div>
        <button onClick={() => setOpen(!open)} className="press ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-primary" aria-expanded={open}>{open ? 'Hide reasons' : 'See why'}<ChevronDown size={14} className={cx('transition-transform duration-200', open && 'rotate-180')} aria-hidden /></button>
      </div>
      {open && (
        <div className="anim-fade-up mt-5 grid gap-x-8 gap-y-6 border-t border-line pt-5 lg:grid-cols-2" data-testid="match-detail">
          <div>
            <h4 className="mb-3 flex items-center gap-1.5 text-[13.5px] font-bold"><Layers size={14} aria-hidden />How the score is built</h4>
            <ul className="space-y-3">
              {m.dimensions.map((d: any, i: number) => (
                <li key={d.key}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="font-semibold">{d.label}{!d.known && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11.5px] font-medium text-muted"><CircleHelp size={11} aria-hidden />unknown</span>}</span><span className="figure shrink-0 text-[13px]">{d.points.toFixed(1)}<span className="font-medium text-faint"> / {d.weight}</span></span></div>
                  <div className="mt-1"><Bar value={d.value} tone="var(--tier)" delay={i * 70} /></div>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted">{d.why}</p>
                </li>))}
            </ul>
          </div>
          <div className="space-y-5">
            <div>
              <h4 className="mb-2 text-[13.5px] font-bold">Skills for {m.roleLabel}</h4>
              <SkillGroup title="Matched" tone="ok" items={m.skills.matched} /><SkillGroup title="Partly matched" tone="warn" items={m.skills.partial} /><SkillGroup title="Not in your profile" tone="neutral" items={m.skills.missing} />
              <p className="mt-2 text-[12px] text-muted">These are typical needs for the role. No job description was used, so the organisation’s own list is unknown.</p>
            </div>
            <div>
              <h4 className="mb-2 text-[13.5px] font-bold">Your most relevant projects</h4>
              {m.projects.filter((p: any) => p.relevance > 0).length ? <ul className="space-y-2">{m.projects.filter((p: any) => p.relevance > 0).map((p: any) => <li key={p.title} className="text-[13px]"><span className="font-semibold">{p.title}</span>{p.status === 'PROPOSED' && <span className="ml-1.5 rounded-full bg-surface2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">Proposed, in progress</span>}<span className="block text-[12.5px] text-muted">Shows {p.hits.slice(0, 4).join(', ')}</span></li>)}</ul> : <p className="text-[13px] text-muted">No recorded project shows this role’s typical tools.</p>}
            </div>
            <div>
              <h4 className="mb-2 text-[13.5px] font-bold">Not verified</h4>
              <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-muted">{m.unverified.map((u: string) => <li key={u}>{u}</li>)}</ul>
            </div>
          </div>
        </div>)}
    </section>
  )
}

function SkillGroup({ title, tone, items }: { title: string; tone: 'ok' | 'warn' | 'neutral'; items: any[] }) {
  if (!items.length) return null
  const cls = tone === 'ok' ? 'bg-ok-bg text-ok' : tone === 'warn' ? 'bg-warn-bg text-warn' : 'bg-surface2 text-muted'
  const mark = tone === 'ok' ? '✓' : tone === 'warn' ? '≈' : '–'
  return <div className="mb-2"><p className="mb-1 text-[12px] font-semibold text-muted">{title}</p><ul className="flex flex-wrap gap-1.5">{items.map((s) => <li key={s.key} title={s.source ?? 'Nothing in your profile shows this'} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold', cls)}><span aria-hidden>{mark}</span>{s.label}</li>)}</ul></div>
}
