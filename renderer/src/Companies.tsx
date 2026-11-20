import { useEffect, useState } from 'react'
import { AlertTriangle, Building2, ExternalLink, Mail, MapPin, Plus, Search, Upload } from 'lucide-react'
import { api, errMsg, STATUS_EXPLAIN } from './api'
import { roleName, useApp } from './ctx'
import { Banner, Button, Chip, Empty, Field, Input, Modal, Select, Spinner, Textarea, Toggle, cx, useAsync, useToast } from './ui'

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => { const m = window.matchMedia('(min-width: 1024px)'); const h = () => setWide(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h) }, [])
  return wide
}
const STATUS_TONE: Record<string, 'ok' | 'info' | 'neutral' | 'warn'> = { VERIFIED_ACTIVE_VACANCY: 'ok', DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING: 'info', PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK: 'warn', UNADVERTISED_SPECULATIVE_TARGET: 'neutral', NEEDS_VERIFICATION: 'neutral' }

export function CompaniesPage() {
  const { boot, refresh, tick } = useApp()
  const toast = useToast()
  const p = boot.profile
  const wide = useWide()
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(true)
  const [role, setRole] = useState('')
  const [owner, setOwner] = useState('')
  const [status, setStatus] = useState('')
  const [tier, setTier] = useState('')
  const [email, setEmail] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const roleKeys = mine ? p.roles.filter((r: string) => r !== 'other') : []
  const list = useAsync(async () => {
    const all: any[] = await api('companies.list', { q, roleFamily: role || undefined, ownership: owner || undefined, status: status || undefined, tier: tier || undefined, hasEmail: email || undefined })
    return mine && !role && roleKeys.length ? all.filter((c) => c.role_families.some((r: string) => roleKeys.includes(r))) : all
  }, [q, role, owner, status, tier, email, mine, tick])
  const rows: any[] = list.data ?? []
  const importFile = async () => {
    try { const r = await api('companies.importPick'); if (r) { toast('ok', `Imported ${r.total} companies (${r.inserted} new, ${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}).`); await refresh() } } catch (e) { toast('bad', errMsg(e)) }
  }

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Companies</h1><p className="mt-1 text-muted">Cyberjaya directory · {boot.companyCount} employers from seed research. Statuses are historical until you verify them.</p></div>
        <div className="flex gap-2"><Button onClick={importFile} icon={<Upload size={15} aria-hidden />}>Import spreadsheet</Button><Button onClick={() => setAdding(true)} icon={<Plus size={15} aria-hidden />}>Add company</Button></div>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden /><Input aria-label="Search companies" placeholder="Search name, industry, role, address" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Toggle on={mine} onClick={() => setMine(!mine)}>Matches my roles</Toggle>
        <Select aria-label="Role family" className="w-auto" value={role} onChange={(e) => setRole(e.target.value)}><option value="">Any role family</option>{boot.roleFamilies.filter((r) => r.key !== 'other').map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>
        <Select aria-label="Employer type" className="w-auto" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Any employer type</option><option value="MNC">MNC</option><option value="GLC">GLC / GLIC</option><option value="PLC">PLC</option><option value="Government">Government / agency</option><option value="Private">Private Malaysian</option><option value="University">University</option></Select>
        <Select aria-label="Internship status evidence" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any evidence</option>{Object.entries(STATUS_EXPLAIN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select aria-label="Priority tier" className="w-auto" value={tier} onChange={(e) => setTier(e.target.value)}><option value="">Any priority</option><option value="T1">Priority 1</option><option value="T2">Priority 2</option><option value="T3">Priority 3</option><option value="T4">Priority 4</option></Select>
        <Toggle on={email} onClick={() => setEmail(!email)}>Has a public email</Toggle>
      </div>
      <p className="mb-2 text-sm text-muted" aria-live="polite">{list.loading ? 'Loading…' : `${rows.length} compan${rows.length === 1 ? 'y' : 'ies'}`}{mine && !role && ` matching ${roleKeys.map((r: string) => roleName(boot, r).split(' / ')[0]).join(', ') || 'your roles'}`}</p>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div>
          {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? <div className="rounded-xl border border-dashed border-line-strong"><Empty title="No companies match" icon={<Building2 size={20} aria-hidden />}>Try turning off “Matches my roles” or clearing a filter.</Empty></div> : (
            <ul className="space-y-2">
              {rows.map((c) => (
                <li key={c.company_id}>
                  <button onClick={() => setSel(c.company_id)} aria-pressed={sel === c.company_id} className={cx('w-full rounded-xl border bg-surface p-3.5 text-left transition-colors duration-150 hover:bg-surface2/60', sel === c.company_id ? 'border-primary ring-1 ring-primary' : 'border-line')}>
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                      <div className="min-w-0 flex-1"><p className="truncate font-medium">{c.name}</p><p className="truncate text-sm text-muted">{c.industry}</p></div>
                      <Chip tone={STATUS_TONE[c.status_enum]} title="Historical research status — not a live vacancy">{STATUS_EXPLAIN[c.status_enum]}</Chip>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted"><Chip>{c.ownership_type}</Chip>{c.role_families.slice(0, 3).map((r: string) => <Chip key={r} tone={p.roles.includes(r) ? 'info' : 'neutral'}>{roleName(boot, r).split(' / ')[0]}</Chip>)}{c.flags.includes('MISSING_WEBSITE') && <Chip tone="warn">No website</Chip>}{c.flags.includes('BROAD_ADDRESS') && <Chip tone="warn" title="Address lacks a building or suite">Broad address</Chip>}{c.hr_email && <Chip tone="ok" icon={<Mail size={11} aria-hidden />}>Email on record</Chip>}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {wide && <aside aria-label="Company detail" className="sticky top-4 hidden max-h-[calc(100vh-3rem)] self-start overflow-y-auto rounded-xl border border-line bg-surface scroll-thin lg:block">{sel ? <CompanyDetail id={sel} /> : <Empty title="Select a company" icon={<Building2 size={20} aria-hidden />}>See evidence, contact route and how to approach them.</Empty>}</aside>}
      </div>
      {!wide && sel && <Modal wide title="Company" onClose={() => setSel(null)}><CompanyDetail id={sel} bare /></Modal>}
      {adding && <AddCompany onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload(); void refresh() }} />}
    </div>
  )
}

function CompanyDetail({ id, bare }: { id: string; bare?: boolean }) {
  const { newApp, tick } = useApp()
  const toast = useToast()
  const c = useAsync(() => api('companies.get', { id }), [id, tick])
  const [note, setNote] = useState('')
  useEffect(() => { if (c.data) setNote(c.data.user_note ?? '') }, [c.data])
  if (!c.data) return <Spinner />
  const d = c.data
  const open = (url: string) => api('link.open', { url: /^https?:/i.test(url) ? url : `https://${url}` }).catch((e) => toast('bad', errMsg(e)))
  return (
    <div className={cx('space-y-4', !bare && 'p-5')}>
      <div><h2 className="text-lg font-semibold leading-snug">{d.name}</h2><p className="text-sm text-muted">{d.legal_entity ?? d.industry}</p></div>
      <div className="space-y-2">
        <Banner tone={d.status_enum === 'VERIFIED_ACTIVE_VACANCY' ? 'ok' : 'info'} title={STATUS_EXPLAIN[d.status_enum]}>Research code “{d.status_code_raw ?? '—'}”. This is a <strong>historical</strong> finding, not a live vacancy.</Banner>
        <p className="flex items-center gap-1.5 text-xs text-muted">Last checked {d.last_verified ?? 'unknown'}{d.age_days != null && ` (${d.age_days} days ago)`}{d.stale && <Chip tone="warn" icon={<AlertTriangle size={11} aria-hidden />}>Re-verify</Chip>}</p>
      </div>
      <dl className="grid grid-cols-[104px_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">Type</dt><dd>{d.ownership_type} · {d.company_size ?? '—'}</dd>
        <dt className="text-muted">Typical roles</dt><dd>{d.relevant_roles ?? '—'}</dd>
        <dt className="text-muted">Address</dt><dd className="flex gap-1"><MapPin size={14} className="mt-1 shrink-0 text-faint" aria-hidden /><span>{d.address ?? '—'}{d.flags.includes('BROAD_ADDRESS') && <span className="block text-xs text-warn">Only the city is known — confirm the exact office before visiting.</span>}</span></dd>
        <dt className="text-muted">Contact route</dt><dd>{d.recommended_method ?? '—'}</dd>
        <dt className="text-muted">Public email</dt><dd>{d.hr_email ? <><span className="break-all">{d.hr_email}</span><span className="block text-xs text-muted">From seed research — verify before using</span></> : /@/.test(d.general_contact ?? '') ? <span className="break-all">{d.general_contact}</span> : <span className="text-muted">None on record{d.general_contact ? ` · ${d.general_contact}` : ''}</span>}</dd>
        <dt className="text-muted">Evidence</dt><dd className="text-muted">{d.evidence_sources ?? '—'}</dd>
        {d.research_notes && <><dt className="text-muted">Notes</dt><dd className="text-muted">{d.research_notes}</dd></>}
      </dl>
      <div className="flex flex-wrap gap-2">
        {d.website ? <Button size="sm" onClick={() => open(d.website)} icon={<ExternalLink size={13} aria-hidden />}>Website</Button> : <Chip tone="warn">No website on record</Chip>}
        {d.careers_page && <Button size="sm" onClick={() => open(d.careers_page)} icon={<ExternalLink size={13} aria-hidden />}>Careers page</Button>}
        {d.linkedin && <Button size="sm" onClick={() => open(d.linkedin)} icon={<ExternalLink size={13} aria-hidden />}>LinkedIn</Button>}
      </div>
      <Field label="Your notes (private)">{(fid) => <Textarea id={fid} rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => api('companies.note', { id, note }).catch((e) => toast('bad', errMsg(e)))} placeholder="Contacts, dates, ideas…" />}</Field>
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <Button variant="primary" onClick={() => newApp({ tab: 'company', companyId: id })}>Create speculative outreach</Button>
        <Button onClick={() => newApp({ tab: 'paste', companyId: id })}>Apply to an advertised vacancy</Button>
        <p className="text-xs text-muted">Speculative outreach is a polite enquiry and is labelled as one — it is never recorded as an active vacancy.</p>
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
      <p className="mb-3 text-sm text-muted">Only you will see this. The seed list is never modified.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(id) => <Input id={id} data-autofocus value={v.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label="Website">{(id) => <Input id={id} value={v.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />}</Field>
        <Field label="Industry">{(id) => <Input id={id} value={v.industry} onChange={(e) => set('industry', e.target.value)} />}</Field>
        <Field label="Address" className="sm:col-span-2">{(id) => <Input id={id} value={v.address} onChange={(e) => set('address', e.target.value)} />}</Field>
        <Field label="Recruitment email (only if you verified it)" className="sm:col-span-2">{(id) => <Input id={id} type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />}</Field>
      </div>
    </Modal>
  )
}
