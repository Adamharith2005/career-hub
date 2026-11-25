import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, LayoutGrid, List, Loader2, Scale, Search, SlidersHorizontal, X } from 'lucide-react'
import { api, errMsg } from '../api'
import { Button, Chip as Badge, Empty, Select, cx, useToast } from '../ui'
import { allowanceMark, evidenceMark, Mark } from './Marks'
import { CompareModal } from './Compare'
import { Dossier } from './Dossier'
import { MatchRing } from './Meter'
import { ALLOWANCE_FILTER, CONTACT_FILTER, CONTACT_TONE, CLASS_LABEL, EVIDENCE_FILTER, EVIDENCE_LABEL, TECH_LABEL } from './labels'
import { useV } from './vctx'

type F = { q: string; city: string; sector: string; classes: string[]; tech: string[]; allowance: string[]; evidence: string[]; contact: string }
const EMPTY: F = { q: '', city: 'All', sector: '', classes: [], tech: [], allowance: [], evidence: [], contact: '' }
const CITIES = ['Cyberjaya', 'Putrajaya', 'IOI Resort City', 'All']
const TYPE_CHIPS: [string, string, string][] = [['GLC', 'GLC', 'glc'], ['MNC', 'MNC', 'mnc'], ['SME', 'SME', 'sme'], ['STARTUP', 'Startup', 'sme'], ['PLC', 'PLC', 'priv'], ['STATUTORY_BODY', 'Statutory body', 'gov']]
const MORE_CLASSES = ['MINISTRY', 'DEPARTMENT', 'AGENCY', 'COMMISSION', 'PUBLIC_INSTITUTION', 'PRIVATE', 'UNIVERSITY_RESEARCH']
const TECH_CHIPS = ['SOFTWARE', 'FULL_STACK', 'CYBERSECURITY', 'CLOUD', 'DEVOPS', 'INFO_SYSTEMS', 'DATA_SCIENCE', 'AI_ML', 'ANALYTICS', 'DATA_ENGINEERING', 'NETWORKING', 'OTHER_CS']
const SORTS: [string, string][] = [['match', 'Best match for me'], ['technical', 'Most relevant technical work'], ['allowance', 'Highest confirmed allowance'], ['verified', 'Verified internship evidence'], ['contact', 'Contact readiness'], ['confidence', 'Research confidence'], ['name', 'Company name']]
const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
const dotFor = (c: any) => c.sector === 'GOVERNMENT' ? 'dot-gov' : c.classes.includes('GLC') ? 'dot-glc' : c.classes.includes('MNC') ? 'dot-mnc' : c.classes.includes('SME') || c.classes.includes('STARTUP') ? 'dot-sme' : c.sector === 'NON_GOVERNMENT' ? 'dot-priv' : 'dot-other'
const kindText = (c: any) => c.sector === 'GOVERNMENT' ? 'Government' : c.sector === 'NON_GOVERNMENT' ? 'Non-government' : 'Unclassified'

/** Segmented control with a sliding pill. */
function Segmented({ options, value, onChange, label }: { options: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => { const el = host.current?.querySelector<HTMLElement>('[aria-pressed="true"]'); if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth }) }
    measure()
    const ro = new ResizeObserver(measure); host.current?.querySelectorAll('button').forEach((b) => ro.observe(b)); document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [value, options.length, options.map((o) => o.count).join()])
  return (
    <div className="seg" role="group" aria-label={label} ref={host}>
      {pill && <span className="seg-pill" aria-hidden style={{ transform: `translateX(${pill.x - 3}px)`, width: pill.w, left: 3 }} />}
      {options.map((o) => <button key={o.key} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>{o.label}{o.count != null && <span className="figure ml-1.5 text-[11px] font-bold opacity-70">{o.count}</span>}</button>)}
    </div>
  )
}

function Chip({ on, onClick, children, count, dot }: { on: boolean; onClick: () => void; children: React.ReactNode; count?: number; dot?: string }) {
  return <button className="chip-f" aria-pressed={on} disabled={count === 0} onClick={onClick}>{dot && <span className={cx('dot', dot)} aria-hidden />}{children}{count != null && <span className="figure text-[11px] font-bold opacity-60">{count}</span>}</button>
}

export function Explorer() {
  const { profile, profileId, selected, select } = useV()
  const toast = useToast()
  const [meta, setMeta] = useState<any>(null)
  const [f, setF] = useState<F>(EMPTY)
  const [sort, setSort] = useState('match')
  const [role, setRole] = useState('')
  const [dense, setDense] = useState(() => { try { return localStorage.getItem('ch.dense') === '1' } catch { return false } })
  const [list, setList] = useState<any[] | null>(null)
  const [more, setMore] = useState(false)
  const [company, setCompany] = useState<any>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [cmp, setCmp] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('v.catalog.meta').then(setMeta).catch((e) => toast('bad', errMsg(e))) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true; setBusy(true)
    const t = setTimeout(() => api('v.companies.list', { q: f.q, city: f.city, sector: f.sector || undefined, classes: f.classes, tech: f.tech, allowance: f.allowance, evidence: f.evidence, contact: f.contact || undefined, profileId, role: role || undefined, sort }).then((l) => { if (live) { setList(l); setBusy(false) } }).catch((e) => { toast('bad', errMsg(e)); setBusy(false) }), f.q ? 150 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [f, profileId, role, sort])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!selected) { setCompany(null); return } let live = true; api('v.companies.get', { id: selected }).then((c) => live && setCompany(c)).catch((e) => toast('bad', errMsg(e))); return () => { live = false } }, [selected])  // eslint-disable-line react-hooks/exhaustive-deps
  const active = f.classes.length + f.tech.length + f.allowance.length + f.evidence.length + (f.sector ? 1 : 0) + (f.contact ? 1 : 0)
  const fx = meta?.facets
  const set = (p: Partial<F>) => setF((x) => ({ ...x, ...p }))
  const mode = (d: boolean) => { setDense(d); try { localStorage.setItem('ch.dense', d ? '1' : '0') } catch { /* private mode */ } }
  const moreClasses = useMemo(() => MORE_CLASSES.filter((k) => fx?.classes?.[k]), [fx])
  const spec = /data/i.test(profile.specialisation) ? 'Data Science' : profile.specialisation

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="hero-band shrink-0 px-7 pb-4 pt-5">
        <div className="relative z-[1]">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <p className="text-[13px] font-semibold text-primary" data-testid="explore-context">{profile.displayName} · {spec} · {profile.university}</p>
              <h1 className="font-display mt-1 text-[2.1rem] leading-[1.05]">Find your internship fit</h1>
            </div>
            <div className="text-right" aria-live="polite" data-testid="result-count"><span className="figure text-[2.1rem] text-primary">{list?.length ?? '…'}</span><span className="ml-1.5 text-[13px] font-semibold text-muted">of {meta?.total ?? '…'} organisations{busy && <Loader2 size={13} className="spin ml-1.5 inline" aria-label="Updating" />}</span></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <Segmented label="Location" value={f.city} onChange={(city) => set({ city })} options={CITIES.map((c) => ({ key: c, label: c === 'All' ? 'All' : c, count: fx && c !== 'All' ? fx.cities[c] : undefined }))} />
            <div className="relative min-w-[190px] flex-1 sm:max-w-[280px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
              <input aria-label="Search companies" data-testid="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search companies or roles" className="h-9 w-full rounded-xl border border-line-strong bg-surface pl-9 pr-3 text-sm placeholder:text-faint focus-visible:border-primary" />
            </div>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted"><span className="max-[1180px]:sr-only">Sort</span><Select aria-label="Sort companies" data-testid="sort" className="h-9 w-auto py-1 text-[13px]" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted"><span className="max-[1180px]:sr-only">Contact</span><Select aria-label="Contact availability" data-testid="contact-filter" className="h-9 w-auto py-1 text-[13px]" value={f.contact} onChange={(e) => set({ contact: e.target.value })}>{CONTACT_FILTER.map(([k, l]) => <option key={k} value={k}>{l}{fx && k ? ` (${fx.contact?.[k] ?? 0})` : ''}</option>)}</Select></label>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted"><span className="max-[1180px]:sr-only">Score as</span><Select aria-label="Score for role" data-testid="role-all" className="h-9 w-auto py-1 text-[13px]" value={role} onChange={(e) => setRole(e.target.value)}><option value="">Best-fit role</option>{[['DATA_ANALYTICS', 'Data analytics / BI'], ['DATA_SCIENCE_ML', 'Data science / ML'], ['DATA_ENGINEERING', 'Data engineering'], ['AI_INTEGRATION', 'AI integration'], ['SOFTWARE', 'Software engineering'], ['FULL_STACK', 'Full-stack development'], ['CYBERSECURITY', 'Cybersecurity'], ['CLOUD_DEVOPS', 'Cloud / DevOps'], ['INFO_SYSTEMS', 'Information systems']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
            <div className="seg ml-auto" role="group" aria-label="View"><button aria-pressed={!dense} onClick={() => mode(false)} aria-label="Visual cards" title="Visual cards"><LayoutGrid size={14} aria-hidden /></button><button aria-pressed={dense} onClick={() => mode(true)} aria-label="Dense research list" title="Dense research list"><List size={14} aria-hidden /></button></div>
          </div>
          <div className="scroll-thin -mx-1 mt-3 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 [&>*]:shrink-0" role="group" aria-label="Filters" data-testid="chips">
            <Chip on={f.sector === 'GOVERNMENT'} count={fx?.sector.GOVERNMENT} dot="dot-gov" onClick={() => set({ sector: f.sector === 'GOVERNMENT' ? '' : 'GOVERNMENT' })}>Government</Chip>
            <Chip on={f.sector === 'NON_GOVERNMENT'} count={fx?.sector.NON_GOVERNMENT} dot="dot-priv" onClick={() => set({ sector: f.sector === 'NON_GOVERNMENT' ? '' : 'NON_GOVERNMENT' })}>Non-government</Chip>
            {TYPE_CHIPS.map(([k, l, d]) => <Chip key={k} on={f.classes.includes(k)} count={fx ? (fx.classes[k] ?? 0) : undefined} dot={`dot-${d}`} onClick={() => set({ classes: toggle(f.classes, k) })}>{l}</Chip>)}
          </div>
          <div className="scroll-thin -mx-1 mt-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 [&>*]:shrink-0" role="group" aria-label="Technical areas">
            {TECH_CHIPS.map((k) => <Chip key={k} on={f.tech.includes(k)} count={fx ? (fx.tech[k] ?? 0) : undefined} onClick={() => set({ tech: toggle(f.tech, k) })}>{TECH_LABEL[k]}</Chip>)}
            <Button size="sm" variant="ghost" onClick={() => setMore(!more)} aria-expanded={more} icon={<SlidersHorizontal size={14} aria-hidden />} data-testid="filters-toggle">More{active > 0 && <span className="figure text-[12px] text-primary">{active}</span>}<ChevronDown size={13} className={cx('transition-transform duration-200', more && 'rotate-180')} aria-hidden /></Button>
            {(active > 0 || f.q || f.city !== 'All') && <Button variant="ghost" size="sm" onClick={() => setF(EMPTY)} icon={<X size={14} aria-hidden />}>Clear</Button>}
          </div>
          {more && fx && (
            <div className="anim-fade-up mt-3 grid gap-x-8 gap-y-4 rounded-xl border border-line bg-surface/80 p-4 md:grid-cols-3" data-testid="filters">
              <fieldset><legend className="mb-1 text-[13px] font-bold">Other organisation types</legend><div className="flex flex-wrap gap-1.5">{moreClasses.map((k) => <Chip key={k} on={f.classes.includes(k)} count={fx.classes[k] ?? 0} onClick={() => set({ classes: toggle(f.classes, k) })}>{CLASS_LABEL[k]}</Chip>)}</div></fieldset>
              <fieldset><legend className="mb-1 text-[13px] font-bold">Allowance</legend><div className="flex flex-wrap gap-1.5">{ALLOWANCE_FILTER.map(([k, l]) => <Chip key={k} on={f.allowance.includes(k)} count={fx.allowance[k] ?? 0} onClick={() => set({ allowance: toggle(f.allowance, k) })}>{l}</Chip>)}</div></fieldset>
              <fieldset><legend className="mb-1 text-[13px] font-bold">Internship evidence</legend><div className="flex flex-wrap gap-1.5">{EVIDENCE_FILTER.map(([k, l]) => <Chip key={k} on={f.evidence.includes(k)} count={fx.evidence[k] ?? 0} onClick={() => set({ evidence: toggle(f.evidence, k) })}>{l}</Chip>)}</div><p className="mt-1.5 text-xs text-muted">Unadvertised organisations are cold-outreach candidates, not open vacancies.</p></fieldset>
            </div>)}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(340px,440px)_minmax(0,1fr)] max-[1100px]:grid-cols-[minmax(310px,360px)_minmax(0,1fr)]">
        <section aria-label="Companies" className="flex min-h-0 flex-col border-r border-line">
          {picked.length > 0 && <div className="flex items-center gap-2 border-b border-line px-5 py-2 text-xs text-muted"><span className="flex-1">{picked.length} chosen to compare</span><Button size="sm" variant="primary" disabled={picked.length < 2} onClick={() => setCmp(true)} icon={<Scale size={14} aria-hidden />} data-testid="compare-btn">Compare ({picked.length})</Button></div>}
          <ul className={cx('scroll-thin min-h-0 flex-1 overflow-y-auto pb-6', !dense && 'space-y-2.5 p-3')} data-testid="company-list">
            {list && list.length === 0 && <li className="p-5"><Empty title="No organisations match" icon={<Search size={18} aria-hidden />}>Clear a filter or search for a different word.</Empty></li>}
            {list?.map((c, i) => dense ? (
              <li key={c.id} className="co-row has-reveal group flex items-center gap-3 py-2 pl-3 pr-3" aria-current={selected === c.id} style={{ animation: i < 14 ? `stagger-in 240ms var(--ease) ${i * 18}ms both` : undefined }}>
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => select(c.id)} data-testid="company-row" aria-current={selected === c.id}>
                  <span className={cx('figure w-9 shrink-0 text-center text-[15px]', c.match ? `tier-${c.match.tier.toLowerCase()} tier-text` : 'text-faint')} title={c.match ? `${c.match.score}% match, ${c.match.roleLabel}${c.match.provisional ? ' (provisional)' : ''}` : ''}>{c.match ? c.match.score : '–'}{c.match?.provisional && <sup aria-label="provisional">?</sup>}</span>
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className={cx('dot', dotFor(c))} aria-hidden /><span className="truncate text-[14px] font-bold">{c.name}</span></span>
                    <span className="block truncate text-[12px] text-muted">{[c.city, kindText(c), c.match?.roleLabel].filter(Boolean).join(' · ')}</span></span>
                  {c.contact && <span className="hidden shrink-0 min-[1250px]:block"><Badge tone={CONTACT_TONE[c.contact.state]} className="text-[11px]">{c.contact.label}</Badge></span>}
                </button>
                <input type="checkbox" aria-label={`Compare ${c.name}`} checked={picked.includes(c.id)} disabled={!picked.includes(c.id) && picked.length >= 4} onChange={() => setPicked(toggle(picked, c.id))} className="h-3.5 w-3.5 accent-[var(--primary)]" />
              </li>
            ) : (
              <li key={c.id} className="co-card has-reveal group p-3.5" aria-current={selected === c.id} style={{ animation: i < 10 ? `stagger-in 300ms var(--ease) ${i * 35}ms both` : undefined }}>
                <div className="flex items-start gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => select(c.id)} data-testid="company-row" aria-current={selected === c.id}>
                    <span className="flex items-center gap-2"><span className={cx('dot', dotFor(c))} aria-hidden /><span className="truncate text-[15px] font-extrabold leading-snug">{c.name}</span></span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-muted">{[c.city, kindText(c), ...c.classes.slice(0, 1).map((k: string) => CLASS_LABEL[k] ?? k)].join(' · ')}</span>
                    {c.tech.length > 0 && <span className="mt-0.5 block truncate text-[12.5px] text-muted">{c.tech.slice(0, 3).map((t: string) => TECH_LABEL[t]).join(', ')}</span>}
                    {c.contact && <span className="mt-2 block"><Badge tone={CONTACT_TONE[c.contact.state]} className="text-[11.5px]"><span data-testid="card-contact">{c.contact.label}</span></Badge></span>}
                    <span className="mt-1.5 flex flex-col gap-0.5 text-[12.5px]">
                      <span className="flex items-center gap-2"><Mark kind={allowanceMark(c.allowanceStatus)} />{c.allowance}</span>
                      <span className="flex items-center gap-2 text-muted"><Mark kind={evidenceMark(c.evidence)} />{EVIDENCE_LABEL[c.evidence]}{c.priorLead && ' · earlier lead, unverified'}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {c.match && <button onClick={() => select(c.id)} aria-label={`${c.match.score}% match as ${c.match.roleLabel}. Open details`} className="press rounded-lg"><MatchRing score={c.match.score} tier={c.match.tier} provisional={c.match.provisional} size={52} label={false} /></button>}
                    {c.match && <span className={cx('max-w-[84px] text-right text-[11px] font-bold leading-tight tier-text', `tier-${c.match.tier.toLowerCase()}`)}>{c.match.provisional ? 'Provisional' : c.match.tier[0] + c.match.tier.slice(1).toLowerCase()}</span>}
                    <input type="checkbox" aria-label={`Compare ${c.name}`} checked={picked.includes(c.id)} disabled={!picked.includes(c.id) && picked.length >= 4} onChange={() => setPicked(toggle(picked, c.id))} className="h-3.5 w-3.5 accent-[var(--primary)]" />
                  </div>
                </div>
              </li>))}
          </ul>
        </section>
        <section aria-label="Company details" className="scroll-thin min-h-0 overflow-y-auto px-8 py-6" data-testid="detail-pane">
          {company ? <Dossier key={company.id} c={company} /> : <div className="grid h-full place-items-center"><Empty title="Select an organisation" icon={<Search size={20} aria-hidden />}>Fit, allowance, contacts, evidence and a ready-to-copy email for {profile.displayName} appear here.</Empty></div>}
        </section>
      </div>
      {cmp && <CompareModal ids={picked} onClose={() => setCmp(false)} />}
    </div>
  )
}
