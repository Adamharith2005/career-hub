import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Building2, Check, ChevronDown, Copy, ExternalLink, Info, MapPin, MoreHorizontal, Plus, Search, SlidersHorizontal, Sparkles, Star, Upload } from 'lucide-react'
import { api, errMsg, STATUS_EXPLAIN } from './api'
import { roleName, useApp } from './ctx'
import { Disclosure, FitBar, ScoreRing, bandIcon, bandOf } from './kit'
import { Banner, Button, Chip, Empty, Field, Input, Modal, Select, Spinner, Textarea, cx, useToast } from './ui'

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => { const m = window.matchMedia('(min-width: 1024px)'); const h = () => setWide(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h) }, [])
  return wide
}
const STATUS_TONE: Record<string, 'ok' | 'info' | 'neutral' | 'warn'> = { VERIFIED_ACTIVE_VACANCY: 'info', DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING: 'neutral', PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK: 'neutral', UNADVERTISED_SPECULATIVE_TARGET: 'neutral', NEEDS_VERIFICATION: 'neutral' }
const short = (l?: string) => (l ?? '').replace(' target', '').replace('Not enough profile information', 'No fit yet')
const roleShort = (boot: any, k: string) => roleName(boot, k).split(' / ')[0].replace('Software Engineer', 'Software').replace('Cloud', 'Cloud')
const TIER_ORDER: Record<string, number> = { T1: 1, T2: 2, T3: 3, T4: 4 }
const SORTS = [['best', 'Best match for you'], ['priority', 'Research priority'], ['name', 'Name A–Z']] as const

export function CompaniesPage() {
  const { boot, refresh, tick, prepare } = useApp()
  const toast = useToast()
  const p = boot.profile
  const wide = useWide()
  const [focus, setFocus] = useState<string>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('best')
  const [role, setRole] = useState(''); const [owner, setOwner] = useState(''); const [status, setStatus] = useState(''); const [route, setRoute] = useState('')
  const [starred, setStarred] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [menu, setMenu] = useState(false)
  const [rows, setRows] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const focusRoles = focus === 'all' ? undefined : [focus]
  // One call returns all companies with a fit computed for THIS profile and focus. Switching profile/focus recomputes; nothing is cached across profiles.
  useEffect(() => {
    let alive = true
    api('companies.list', { focusRoles }).then((r) => { if (alive) { setRows(r); setError(null) } }).catch((e) => alive && setError(errMsg(e)))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, tick, p.profile_id])
  useEffect(() => { setFocus('all'); setSel(null) }, [p.profile_id])

  const total = rows?.length ?? 0
  const view = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = (rows ?? []).filter((c) =>
      (!s || [c.name, c.industry, c.relevant_roles, c.address, c.ownership_type].join(' ').toLowerCase().includes(s)) &&
      (!role || c.role_families.includes(role)) && (!owner || (c.ownership_type ?? '').toLowerCase().includes(owner.toLowerCase())) && (!status || c.status_enum === status) &&
      (!route || (route === 'careers' ? !!c.careers_page : !!c.hr_email || /@/.test(c.general_contact ?? ''))) && (!starred || c.shortlisted))
    const byName = (a: any, b: any) => a.name.localeCompare(b.name)
    return list.sort(sort === 'name' ? byName : sort === 'priority'
      ? (a, b) => (TIER_ORDER[a.priority_tier] ?? 9) - (TIER_ORDER[b.priority_tier] ?? 9) || (a.seed_rank ?? 999) - (b.seed_rank ?? 999) || byName(a, b)
      : (a, b) => (b.fit.score ?? -1) - (a.fit.score ?? -1) || byName(a, b))
  }, [rows, q, role, owner, status, route, starred, sort])
  const scored = (rows ?? []).some((c) => c.fit.status === 'scored')
  const topMatch = useMemo(() => (rows ?? []).filter((c) => c.fit.status === 'scored').sort((a, b) => b.fit.score - a.fit.score || a.name.localeCompare(b.name))[0] ?? view[0], [rows, view])
  const activeFilters = [role, owner, status, route].filter(Boolean).length
  const selected = view.find((c) => c.company_id === sel) ?? (rows ?? []).find((c) => c.company_id === sel) ?? null

  const select = (id: string, scroll = false) => {
    setSel(id)
    if (scroll) requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
  const toggleStar = async (c: any) => {
    setRows((rs) => rs && rs.map((r) => r.company_id === c.company_id ? { ...r, shortlisted: !r.shortlisted } : r))
    try { await api('companies.shortlist', { id: c.company_id, on: !c.shortlisted }) } catch (e) { toast('bad', errMsg(e)); setRows((rs) => rs && rs.map((r) => r.company_id === c.company_id ? { ...r, shortlisted: c.shortlisted } : r)) }
  }
  const onListKey = (e: React.KeyboardEvent) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-row]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null
    if (to != null && items[to]) { e.preventDefault(); items[to].focus() }
  }
  const importFile = async () => {
    setMenu(false)
    try { const r = await api('companies.importPick'); if (r) { toast('ok', `Imported ${r.total} companies (${r.inserted} new, ${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}).`); await refresh() } } catch (e) { toast('bad', errMsg(e)) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="eyebrow">Cyberjaya, Malaysia</p>
            <h1 className="page-title mt-1">Explore Cyberjaya</h1>
            <p className="mt-1.5 text-muted">Find the right companies for your role, then prepare a tailored application.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={`Fit for ${p.name.split(' ')[0]}`} className="w-[210px]">{(id) => (
              <Select id={id} value={focus} onChange={(e) => setFocus(e.target.value)}>
                <option value="all">All my target roles</option>
                {(p.roles as string[]).filter((r) => r !== 'other').map((r) => <option key={r} value={r}>{roleName(boot, r)}</option>)}
              </Select>)}</Field>
            <div className="relative">
              <Button aria-haspopup="menu" aria-expanded={menu} aria-label="More actions" onClick={() => setMenu(!menu)}><MoreHorizontal size={16} aria-hidden /></Button>
              {menu && <div role="menu" className="card anim-fade absolute right-0 z-30 mt-1 w-56 p-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
                <button role="menuitem" onClick={() => { setMenu(false); setAdding(true) }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface2"><Plus size={14} aria-hidden />Add a company</button>
                <button role="menuitem" onClick={importFile} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface2"><Upload size={14} aria-hidden />Import company spreadsheet</button>
              </div>}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-md"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden /><Input aria-label="Search companies" placeholder="Search by company, industry or role" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select aria-label="Sort by" className="w-auto" value={sort} onChange={(e) => setSort(e.target.value as any)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Button aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)} icon={<SlidersHorizontal size={15} aria-hidden />}>Filters{activeFilters > 0 && <span className="ml-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] text-on-primary">{activeFilters}</span>}</Button>
          <Button aria-pressed={starred} onClick={() => setStarred(!starred)} className={cx(starred && '!border-primary !bg-primary-soft !text-primary')} icon={<Star size={15} className={cx(starred && 'fill-current')} aria-hidden />}>Shortlist</Button>
        </div>
        {filtersOpen && (
          <div className="card anim-fade mt-2 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Role area">{(id) => <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}><option value="">Any</option>{boot.roleFamilies.filter((r) => r.key !== 'other').map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>}</Field>
            <Field label="Employer type">{(id) => <Select id={id} value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Any</option><option value="MNC">Multinational</option><option value="GLC">Government-linked</option><option value="PLC">Listed company</option><option value="Government">Government / agency</option><option value="Private">Private Malaysian</option><option value="University">University</option></Select>}</Field>
            <Field label="Opportunity status">{(id) => <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option>{Object.entries(STATUS_EXPLAIN).filter(([k]) => k !== 'NEEDS_VERIFICATION').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
            <Field label="How to apply">{(id) => <Select id={id} value={route} onChange={(e) => setRoute(e.target.value)}><option value="">Any</option><option value="careers">Has a careers page</option><option value="email">Has a public email</option></Select>}</Field>
            {activeFilters > 0 && <div className="sm:col-span-2 lg:col-span-4"><button onClick={() => { setRole(''); setOwner(''); setStatus(''); setRoute('') }} className="text-sm font-medium text-primary hover:underline">Clear filters</button></div>}
          </div>
        )}
        <p className="mt-3 text-sm text-muted tnum" aria-live="polite">
          {rows ? <><strong className="font-semibold text-ink">{view.length}</strong> of {total} Cyberjaya companies{focus !== 'all' ? <> · fit for <strong className="font-medium text-ink">{roleName(boot, focus)}</strong></> : ''}{sort === 'best' && scored ? ' · best match first' : ''}</> : 'Loading companies…'}
        </p>
      </header>

      {error && <Banner tone="bad" title="Couldn’t load companies">{error}</Banner>}
      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(340px,5fr)_minmax(0,7fr)]">
        <div className="scroll-thin min-h-0 overflow-y-auto pr-1" data-testid="company-list">
          {!rows ? <Spinner label="Loading companies" /> : (
            <>
              {!scored && <div className="mb-3"><Banner tone="info" title="Add a few details to see how well each company fits you">Pick a target role, add a skill and one project in My Profile. Until then, companies are listed by research priority.</Banner></div>}
              {view.length === 0 ? <div className="card border-dashed"><Empty title="No companies match" icon={<Building2 size={20} aria-hidden />} action={<Button onClick={() => { setQ(''); setRole(''); setOwner(''); setStatus(''); setRoute(''); setStarred(false) }}>Clear search and filters</Button>}>Try fewer filters or a different search.</Empty></div> : (
                <ul ref={listRef} onKeyDown={onListKey} aria-label="Cyberjaya companies" className="space-y-2 pb-6">
                  {view.map((c) => <CompanyRow key={c.company_id} c={c} boot={boot} focusRoles={focusRoles ?? (p.roles as string[])} active={sel === c.company_id} onSelect={() => select(c.company_id)} onStar={() => toggleStar(c)} />)}
                </ul>
              )}
            </>
          )}
        </div>

        {wide && (
          <aside aria-label="Company detail" className="card scroll-thin relative min-h-0 overflow-y-auto">
            {selected ? <CompanyDetail key={selected.company_id} c={selected} focusRoles={focusRoles} onStar={() => toggleStar(selected)} onPrepare={() => prepare({ companyId: selected.company_id, focusRoles })} />
              : <EmptyDetail top={topMatch} scored={scored} onStart={() => topMatch && select(topMatch.company_id, true)} />}
          </aside>
        )}
      </div>
      {!wide && selected && <Modal wide title={selected.name} onClose={() => setSel(null)}><CompanyDetail key={selected.company_id} c={selected} focusRoles={focusRoles} bare onStar={() => toggleStar(selected)} onPrepare={() => { setSel(null); prepare({ companyId: selected.company_id, focusRoles }) }} /></Modal>}
      {adding && <AddCompany onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void refresh() }} />}
    </div>
  )
}

// ------------------------------------------------------------------ list row
function CompanyRow({ c, boot, focusRoles, active, onSelect, onStar }: { c: any; boot: any; focusRoles: string[]; active: boolean; onSelect: () => void; onStar: () => void }) {
  const fit = c.fit
  const band = bandOf(fit.label)
  const tags = [...c.role_families].filter((r: string) => r !== 'other').sort((a: string, b: string) => Number(focusRoles.includes(b)) - Number(focusRoles.includes(a))).slice(0, 3)
  return (
    <li className="relative" data-id={c.company_id}>
      <button data-row aria-current={active ? 'true' : undefined} onClick={onSelect}
        className={cx('press lift w-full rounded-xl border bg-surface p-3.5 pr-12 text-left', active ? 'border-primary shadow-md ring-1 ring-primary' : 'border-line hover:border-line-strong')}>
        <div className="flex items-start gap-3">
          <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 pt-0.5" title={fit.status === 'scored' ? `${fit.label} · ${fit.confidence.toLowerCase()} confidence` : 'Add profile details to see fit'}>
            <ScoreRing score={fit.score} label={fit.label} size={40} />
            <span className="text-[10.5px] font-medium leading-none text-muted">{fit.status === 'scored' ? <><span aria-hidden>{bandIcon(band)} </span>{short(fit.label)}</> : '—'}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-[17px] font-semibold leading-snug">{c.name}</p>
            <p className="truncate text-sm text-muted">{c.industry}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip>{c.ownership_type}</Chip>
              {tags.map((r: string) => <Chip key={r} tone={focusRoles.includes(r) ? 'info' : 'neutral'}>{roleShort(boot, r)}</Chip>)}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Info size={12} className="shrink-0" aria-hidden /><span className="truncate">{STATUS_EXPLAIN[c.status_enum]}</span>{c.location.state !== 'VERIFIED' && <span className="inline-flex shrink-0 items-center gap-0.5 text-warn"><AlertTriangle size={11} aria-hidden />check location</span>}</p>
          </div>
        </div>
      </button>
      <button aria-pressed={c.shortlisted} aria-label={c.shortlisted ? `Remove ${c.name} from shortlist` : `Add ${c.name} to shortlist`} onClick={onStar}
        className={cx('press absolute right-2.5 top-2.5 rounded-lg p-1.5 hover:bg-surface2', c.shortlisted ? 'text-primary' : 'text-faint')}><Star size={17} className={cx(c.shortlisted && 'fill-current')} aria-hidden /></button>
    </li>
  )
}

// ------------------------------------------------------------------ empty detail: a designed starting point, not a blank panel
function EmptyDetail({ top, scored, onStart }: { top: any; scored: boolean; onStart: () => void }) {
  return (
    <div className="hero-wash grid h-full min-h-[420px] place-items-center rounded-[14px] p-8">
      <div className="anim-fade-up max-w-sm text-center">
        <svg viewBox="0 0 240 130" className="mx-auto mb-5 w-60" role="img" aria-label="Illustration of Cyberjaya office towers with a fit meter">
          <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".9" /><stop offset="1" stopColor="var(--primary)" stopOpacity=".85" /></linearGradient></defs>
          <rect x="0" y="118" width="240" height="2" rx="1" fill="var(--line-strong)" />
          <rect x="22" y="58" width="34" height="60" rx="4" fill="var(--surface3)" /><rect x="64" y="30" width="42" height="88" rx="5" fill="url(#g1)" />
          <rect x="114" y="70" width="30" height="48" rx="4" fill="var(--surface3)" /><rect x="152" y="44" width="38" height="74" rx="5" fill="var(--primary-soft)" stroke="var(--line-strong)" />
          <rect x="198" y="82" width="22" height="36" rx="4" fill="var(--surface3)" />
          {[40, 52, 64, 76, 88].map((y) => <g key={y}><rect x="72" y={y} width="8" height="5" rx="1.5" fill="#fff" fillOpacity=".7" /><rect x="90" y={y} width="8" height="5" rx="1.5" fill="#fff" fillOpacity=".5" /></g>)}
          <circle cx="178" cy="22" r="15" fill="var(--surface)" stroke="var(--line-strong)" /><path d="M178 8 A14 14 0 1 1 164.5 25" fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
        </svg>
        <h2 className="font-display text-2xl font-semibold">Pick a company to see why it fits</h2>
        <p className="mt-2 text-sm text-muted">{scored ? 'Select any company on the left for your personal fit, what to prepare, and the best way to approach them.' : 'Select a company to see what it does and how to approach it. Add details to My Profile to see how well it fits you.'}</p>
        {top && <Button variant="primary" className="mt-5" onClick={onStart} icon={<Sparkles size={15} aria-hidden />}>{scored ? `Start with your top match` : `Start with ${top.name}`}</Button>}
        {top && scored && <p className="mt-2 text-xs text-muted">Currently: {top.name}</p>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ detail
function CompanyDetail({ c, focusRoles, onStar, onPrepare, bare }: { c: any; focusRoles?: string[]; onStar: () => void; onPrepare: () => void; bare?: boolean }) {
  const { boot, go } = useApp()
  const toast = useToast()
  const fit = c.fit
  const [more, setMore] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [full, setFull] = useState<any>(null)
  useEffect(() => { let a = true; api('companies.get', { id: c.company_id }).then((d) => { if (a && d) { setFull(d); setNote(d.user_note ?? '') } }); return () => { a = false } }, [c.company_id])
  const open = (url: string) => api('link.open', { url: /^https?:/i.test(url) ? url : `https://${url}` }).catch((e) => toast('bad', errMsg(e)))
  const email = c.hr_email || (/@/.test(c.general_contact ?? '') ? c.general_contact : null)
  const band = bandOf(fit.label)
  const confidenceText = fit.confidence === 'HIGH' ? 'High' : fit.confidence === 'MEDIUM' ? 'Medium' : 'Low'
  const mine = (focusRoles ?? boot.profile.roles) as string[]
  const meaning = fit.status !== 'scored' ? '' : band === 'excellent' ? 'Closely matches the roles you want and the work you’ve done.' : band === 'strong' ? 'Worth prioritising — good overlap with your roles and evidence.' : band === 'possible' ? 'Some overlap. A good enquiry could still work.' : 'Little overlap with your chosen roles right now.'

  return (
    <div className={cx('anim-detail flex flex-col', !bare && 'h-full')}>
      <div className={cx('space-y-6', !bare && 'flex-1 p-6')}>
        <header>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{c.ownership_type}{c.company_size ? ` · ${c.company_size}` : ''}</p>
              <h2 className="font-display mt-1 text-[28px] font-semibold leading-tight">{c.name}</h2>
              <p className="mt-1 text-muted">{c.industry}</p>
            </div>
            <Button size="sm" aria-pressed={c.shortlisted} onClick={onStar} className={cx(c.shortlisted && '!border-primary !bg-primary-soft !text-primary')} icon={<Star size={14} className={cx(c.shortlisted && 'fill-current')} aria-hidden />}>{c.shortlisted ? 'Shortlisted' : 'Shortlist'}</Button>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-sm"><MapPin size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden /><span className="min-w-0"><span className="break-words">{c.address ?? 'No address on record'}</span>
            <span className={cx('mt-0.5 flex items-center gap-1 text-xs', c.location.state === 'VERIFIED' ? 'text-ok' : 'text-warn')}>{c.location.state === 'VERIFIED' ? <Check size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}{c.location.note}</span></span></p>
        </header>

        {/* fit */}
        <section aria-labelledby="fit-h" className="card-soft p-4">
          <h3 id="fit-h" className="eyebrow mb-3">Company/role alignment estimate — how well this employer matches you</h3>
          {fit.status === 'scored' ? (
            <>
              <div className="flex items-center gap-4">
                <ScoreRing score={fit.score} label={fit.label} size={76} stroke={8} />
                <div className="min-w-0">
                  <p className="text-lg font-semibold"><span aria-hidden>{bandIcon(band)} </span>{fit.label}</p>
                  <p className="text-sm text-muted">{meaning}</p>
                  <p className="mt-1 text-xs text-muted">Role alignment: <strong className="text-ink">{fit.roleAlignment}</strong> · Evidence confidence: <strong className="text-ink">{confidenceText}</strong></p>
                </div>
              </div>
              <div className="mt-3"><Disclosure summary="How we scored this">
                <ul className="space-y-2.5">
                  {fit.components.map((k: any) => (
                    <li key={k.key}><div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]"><span className="font-medium">{k.label} <span className="font-normal text-faint">· weight {Math.round(k.weight * 100)}%</span></span><span className="tnum text-muted">{k.value == null ? 'not enough information' : `${Math.round(k.value * 100)}%`}</span></div><FitBar value={k.value} /><p className="mt-1 text-xs text-muted">{k.note}</p></li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted">{fit.disclaimer} Rounded to the nearest 5 because the company research is an estimate. Information we don’t have lowers confidence — it is never counted as a weakness.</p>
              </Disclosure></div>
            </>
          ) : (
            <div className="flex items-start gap-3">
              <ScoreRing score={null} size={56} />
              <div><p className="font-semibold">Not enough profile information</p><p className="mt-0.5 text-sm text-muted">{fit.missingProfile.join(' · ') || 'Add a few details to see your fit.'}</p><Button size="sm" className="mt-2" onClick={() => go('profile')} icon={<ArrowRight size={14} aria-hidden />}>Open My Profile</Button></div>
            </div>
          )}
        </section>

        {fit.warnings.map((w: string) => <Banner key={w} tone="warn" title="Check eligibility">{w}</Banner>)}

        {/* opportunity: never presented as live */}
        <section aria-labelledby="opp-h">
          <h3 id="opp-h" className="eyebrow mb-2">Opportunity</h3>
          <Banner tone={fit.vacancy.state === 'HISTORICAL_LISTING' ? 'info' : 'neutral'} title={fit.vacancy.headline}>{fit.vacancy.detail}</Banner>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">Researched {c.last_verified ?? 'date unknown'}{c.age_days != null && ` (${c.age_days} days ago)`}{c.stale && <Chip tone="warn" icon={<AlertTriangle size={11} aria-hidden />}>Re-check before relying on it</Chip>}</p>
        </section>

        {fit.status === 'scored' && fit.reasons.length > 0 && (
          <section aria-labelledby="why-h"><h3 id="why-h" className="eyebrow mb-2">Why this company?</h3>
            <ul className="space-y-1.5 text-[15px]">{fit.reasons.map((r: string) => <li key={r} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-primary" aria-hidden /><span>{r}</span></li>)}</ul></section>
        )}

        <section aria-labelledby="roles-h"><h3 id="roles-h" className="eyebrow mb-2">Roles they hire for</h3>
          <div className="flex flex-wrap gap-1.5">{c.role_families.filter((r: string) => r !== 'other').map((r: string) => <Chip key={r} tone={mine.includes(r) ? 'info' : 'neutral'} icon={mine.includes(r) ? <Check size={11} aria-hidden /> : undefined}>{roleName(boot, r)}</Chip>)}</div>
          {c.relevant_roles && <p className="mt-2 text-sm text-muted">Researched titles: {c.relevant_roles}</p>}</section>

        {fit.status === 'scored' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <section aria-labelledby="str-h"><h3 id="str-h" className="eyebrow mb-2">Your strengths here</h3>{fit.strengths.length ? <ul className="space-y-1 text-sm">{fit.strengths.map((s: string) => <li key={s} className="flex gap-2"><Check size={14} className="mt-1 shrink-0 text-ok" aria-hidden /><span>{s}</span></li>)}</ul> : <p className="text-sm text-muted">Add related skills or a project to build this list.</p>}</section>
            <section aria-labelledby="gap-h"><h3 id="gap-h" className="eyebrow mb-2">Could strengthen</h3>{fit.gaps.length ? <ul className="space-y-1 text-sm text-muted">{fit.gaps.map((s: string) => <li key={s}>• {s}</li>)}</ul> : <p className="text-sm text-muted">Nothing obvious to flag.</p>}</section>
          </div>
        )}

        {fit.status === 'scored' && fit.missingProfile.length > 0 && <Banner tone="info" title="To make this more reliable">{fit.missingProfile.join(' · ')}</Banner>}

        <div className="grid gap-3 sm:grid-cols-2">
          <section className="card-soft p-3.5"><h3 className="eyebrow mb-1.5">Suggested resume angle</h3><p className="text-sm">{fit.status === 'scored' ? fit.resumeAngle.text : 'Complete your profile to get a suggested angle.'}</p></section>
          <section className="card-soft p-3.5"><h3 className="eyebrow mb-1.5">Suggested outreach</h3><p className="text-sm">{fit.outreachAngle}</p></section>
        </div>

        <section aria-labelledby="route-h"><h3 id="route-h" className="eyebrow mb-2">How to reach them</h3>
          <dl className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Careers page</dt><dd>{c.careers_page ? <button onClick={() => open(c.careers_page)} className="inline-flex max-w-full items-center gap-1 break-all text-left font-medium text-primary hover:underline"><ExternalLink size={13} className="shrink-0" aria-hidden />{c.careers_page.replace(/^https?:\/\//, '')}</button> : <span className="text-muted">None on record</span>}</dd>
            <dt className="text-muted">Public email</dt><dd>{email ? <><span className="break-all">{email}</span><span className="block text-xs text-muted">From research — verify before using</span></> : <span className="text-muted">None on record{c.general_contact ? ` · ${c.general_contact}` : ''}</span>}</dd>
            <dt className="text-muted">Suggested route</dt><dd className="text-muted">{c.recommended_method ?? '—'}</dd>
            <dt className="text-muted">Sources</dt><dd className="break-words text-muted">{c.evidence_sources ?? '—'}</dd>
            {c.research_notes && <><dt className="text-muted">Notes</dt><dd className="text-muted">{c.research_notes}</dd></>}
          </dl>
        </section>

        <div className="relative">
          <Button size="sm" aria-expanded={more} onClick={() => setMore(!more)} icon={<ChevronDown size={14} aria-hidden />}>More options</Button>
          {more && (
            <div className="anim-fade mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                {c.website && <Button size="sm" onClick={() => open(c.website)} icon={<ExternalLink size={13} aria-hidden />}>Website</Button>}
                {c.linkedin && <Button size="sm" onClick={() => open(c.linkedin)} icon={<ExternalLink size={13} aria-hidden />}>LinkedIn</Button>}
                {email && <Button size="sm" onClick={() => navigator.clipboard.writeText(email).then(() => toast('ok', 'Email address copied'))} icon={<Copy size={13} aria-hidden />}>Copy email address</Button>}
                <Button size="sm" onClick={() => setNoteOpen(!noteOpen)}>{noteOpen ? 'Hide notes' : 'Edit notes'}</Button>
              </div>
              {noteOpen && <Field label="Your private notes">{(fid) => <Textarea id={fid} rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => api('companies.note', { id: c.company_id, note }).catch((e) => toast('bad', errMsg(e)))} placeholder="Contacts, dates, ideas…" />}</Field>}
              {!full && noteOpen && <Spinner />}
            </div>
          )}
        </div>
      </div>

      <div className={cx('z-10 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-6 py-3.5', !bare ? 'sticky bottom-0 rounded-b-[14px]' : 'mt-6 -mx-5')}>
        <Button variant="primary" onClick={onPrepare} className="h-10 px-5 text-[15px]" icon={<ArrowRight size={16} aria-hidden />}>Prepare application</Button>
        {c.careers_page && <Button onClick={() => open(c.careers_page)} icon={<ExternalLink size={14} aria-hidden />}>Careers page</Button>}
        <span className="min-w-0 flex-1 text-xs text-muted">{fit.vacancy.state === 'HISTORICAL_LISTING' ? 'Confirm the listing is still open first.' : 'No opening verified — we’ll prepare an enquiry.'}</span>
      </div>
    </div>
  )
}

function AddCompany({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [v, setV] = useState({ name: '', website: '', address: '', industry: '', email: '', notes: '' })
  const set = (k: string, x: string) => setV((s) => ({ ...s, [k]: x }))
  return (
    <Modal title="Add a company" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!v.name.trim()} onClick={async () => { try { await api('companies.add', v); toast('ok', 'Company added to your directory.'); onSaved() } catch (e) { toast('bad', errMsg(e)) } }}>Add</Button></>}>
      <p className="mb-3 text-sm text-muted">Only you will see this. Companies outside Cyberjaya are kept out of the main list, and the seed list is never modified.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(id) => <Input id={id} data-autofocus value={v.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label="Website">{(id) => <Input id={id} value={v.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />}</Field>
        <Field label="Industry">{(id) => <Input id={id} value={v.industry} onChange={(e) => set('industry', e.target.value)} />}</Field>
        <Field label="Cyberjaya address" className="sm:col-span-2">{(id) => <Input id={id} value={v.address} onChange={(e) => set('address', e.target.value)} />}</Field>
        <Field label="Recruitment email (only if you verified it)" className="sm:col-span-2">{(id) => <Input id={id} type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />}</Field>
      </div>
    </Modal>
  )
}
