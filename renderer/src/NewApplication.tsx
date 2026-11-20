import { useEffect, useState } from 'react'
import { Link2, Search, Sparkles } from 'lucide-react'
import { api, errMsg, REC } from './api'
import { roleName, useApp, type NewAppOpts } from './ctx'
import { Banner, Button, Chip, Field, Input, Modal, Select, Tabs, Textarea, cx, useToast } from './ui'

type Tab = 'paste' | 'url' | 'company'

export function NewApplication({ opts, onClose }: { opts: NewAppOpts; onClose: () => void }) {
  const { boot, openApp, refresh } = useApp()
  const toast = useToast()
  const p = boot.profile
  const defaultType = p.career_types.includes('INTERNSHIP') ? 'INTERNSHIP' : 'GRADUATE'
  const [tab, setTab] = useState<Tab>(opts.tab ?? 'paste')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [careerType, setCareerType] = useState<'INTERNSHIP' | 'GRADUATE'>(defaultType)
  const [busy, setBusy] = useState(false)
  const [urlErr, setUrlErr] = useState('')
  const [result, setResult] = useState<any>(null)
  const [form, setForm] = useState({ company: '', title: '', location: '', roleFamily: 'swe' })
  const [companyId, setCompanyId] = useState<string | null>(opts.companyId ?? null)
  const [companyQ, setCompanyQ] = useState('')
  const [companies, setCompanies] = useState<any[]>([])
  const [roleTitle, setRoleTitle] = useState('')
  const [manual, setManual] = useState(false)

  useEffect(() => { if (tab === 'company') api('companies.list', { q: companyQ }).then(setCompanies).catch(() => {}) }, [tab, companyQ])
  const selected = companyId ? (companies.find((c) => c.company_id === companyId) ?? null) : null
  useEffect(() => { if (companyId && !selected) api('companies.get', { id: companyId }).then((c) => c && setCompanies((x) => [c, ...x])) }, [companyId, selected])
  useEffect(() => { if (selected && !roleTitle) setRoleTitle(`${roleName(boot, p.primary_role).replace(/ \/ .*$/, '')} ${careerType === 'INTERNSHIP' ? 'Intern' : 'Graduate'}`) }, [selected, careerType, boot, p.primary_role, roleTitle])

  const analyze = async (jobText: string, jobUrl?: string) => {
    setBusy(true)
    try {
      const co = companyId ? companies.find((c) => c.company_id === companyId) : null
      const r = await api('job.analyze', { text: jobText, companyId, careerType, company: co?.name })
      setResult({ ...r, jobText, jobUrl })
      setForm({ company: r.spec.company ?? co?.name ?? '', title: r.spec.title ?? '', location: r.spec.location ?? '', roleFamily: r.spec.roleFamily })
      setCareerType(r.careerType)
    } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const fetchUrl = async () => {
    setBusy(true); setUrlErr('')
    try { const r = await api('job.fetchUrl', { url }); setBusy(false); await analyze(r.text, r.finalUrl) }
    catch (e) { setBusy(false); setUrlErr(errMsg(e)) }
  }
  const save = async () => {
    if (!form.company.trim() || !form.title.trim()) return toast('warn', 'Company and role title are required.')
    setBusy(true)
    try {
      const changed = result && form.roleFamily !== result.spec.roleFamily
      const analysis = result ? { spec: { ...result.spec, roleFamily: form.roleFamily, company: form.company, title: form.title }, assessment: changed ? null : result.assessment, compensation: result.compensation } : undefined
      const id = await api('app.create', { companyId, company: form.company, title: form.title, roleFamily: form.roleFamily, careerType, location: form.location, jobText: result?.jobText ?? text, jobUrl: result?.jobUrl, analysis, contactEmail: result?.contactEmail ?? null })
      await refresh(); onClose(); openApp(id)
    } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const saveSpeculative = async () => {
    if (!selected || !roleTitle.trim()) return
    setBusy(true)
    try {
      const id = await api('app.create', { companyId: selected.company_id, company: selected.name, title: roleTitle, roleFamily: p.primary_role ?? 'swe', careerType, mode: 'SPECULATIVE_OUTREACH', source: 'Cyberjaya directory (speculative)' })
      await refresh(); onClose(); openApp(id)
    } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }

  const missing = (v: string) => !v.trim()
  const rec = result ? REC[result.assessment.recommendation] : null
  const typeSel = (
    <Field label="Applying for" className="w-full sm:w-56">{(id) => <Select id={id} value={careerType} onChange={(e) => setCareerType(e.target.value as any)}><option value="INTERNSHIP">Internship</option><option value="GRADUATE">Graduate / Entry-level</option></Select>}</Field>
  )

  return (
    <Modal wide title={result ? 'Review & save' : 'New application'} onClose={onClose}
      footer={result ? <><Button onClick={() => setResult(null)}>Back</Button><Button variant="primary" busy={busy} onClick={save}>Save application</Button></> : tab === 'paste' ? <>
          <Button onClick={() => setManual(true)} title="Save without analysis">Save job manually</Button>
          <Button variant="primary" busy={busy} disabled={text.trim().length < 40} onClick={() => analyze(text)} icon={<Sparkles size={15} aria-hidden />}>Analyze role</Button></>
        : tab === 'url' ? <Button variant="primary" busy={busy} disabled={!url.trim()} onClick={fetchUrl} icon={<Link2 size={15} aria-hidden />}>Fetch & analyze</Button>
        : <Button variant="primary" busy={busy} disabled={!selected || !roleTitle.trim()} onClick={saveSpeculative}>Create speculative outreach</Button>}>
      {!result && (
        <>
          <Tabs label="How to add a job" value={tab} onChange={(t) => { setTab(t); setUrlErr('') }} tabs={[{ key: 'paste', label: 'Paste job description' }, { key: 'url', label: 'Paste job URL' }, { key: 'company', label: 'Choose Cyberjaya company' }]} />
          <div className="pt-4" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'paste' && (
              <div className="space-y-3">
                {companyId && <Banner tone="info">Company: <strong>{selected?.name ?? '…'}</strong> — the job text below is treated as an advertised vacancy.</Banner>}
                <Field label="Job description" hint="Paste the full ad. It is analysed on this computer unless you’ve enabled AI.">{(id) => <Textarea id={id} data-autofocus rows={11} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the job ad here — title, requirements, duration, allowance…" />}</Field>
                <div className="flex flex-wrap gap-3">{typeSel}</div>
              </div>
            )}
            {tab === 'url' && (
              <div className="space-y-3">
                <Field label="Job URL" hint="Public pages only. We fetch the one page you give us — no logins, no CAPTCHAs.">{(id) => <Input id={id} data-autofocus value={url} onChange={(e) => { setUrl(e.target.value); setUrlErr('') }} placeholder="https://careers.example.com/jobs/123" inputMode="url" />}</Field>
                {urlErr && <Banner tone="warn" title="Couldn’t read that page" action={<Button size="sm" onClick={() => { setTab('paste') }}>Paste text instead</Button>}>{urlErr}</Banner>}
                <div className="flex flex-wrap gap-3">{typeSel}</div>
              </div>
            )}
            {tab === 'company' && (
              <div className="space-y-3">
                <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden /><Input aria-label="Search companies" data-autofocus className="pl-9" placeholder="Search the 78 Cyberjaya companies" value={companyQ} onChange={(e) => setCompanyQ(e.target.value)} /></div>
                <ul className="scroll-thin max-h-[230px] divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label="Companies">
                  {companies.slice(0, 40).map((c) => (
                    <li key={c.company_id}><button onClick={() => { setCompanyId(c.company_id); setRoleTitle('') }} aria-pressed={companyId === c.company_id} className={cx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface2', companyId === c.company_id && 'bg-primary-soft')}>
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-xs text-muted">{c.industry}</span></span>
                      {c.role_families.includes(p.primary_role) && <Chip tone="info">Your focus</Chip>}</button></li>
                  ))}
                  {!companies.length && <li className="px-3 py-4 text-center text-sm text-muted">No matches</li>}
                </ul>
                {selected && (
                  <div className="space-y-3 rounded-lg bg-surface2 p-3">
                    <p className="text-sm"><strong>{selected.name}</strong> — {selected.status_enum === 'VERIFIED_ACTIVE_VACANCY' ? 'seed research recorded a listing (historical — confirm it is still open).' : 'no advertised vacancy is on record.'}</p>
                    <div className="flex flex-wrap items-end gap-3"><Field label="Role you are asking about" className="min-w-[220px] flex-1">{(id) => <Input id={id} value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />}</Field>{typeSel}</div>
                    <p className="text-xs text-muted">This creates a <strong>speculative enquiry</strong>, clearly labelled as such. Have an actual advertisement? <button className="font-medium text-primary hover:underline" onClick={() => setTab('paste')}>Paste it instead</button>.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {result && (
        <div className="space-y-4">
          {result.ai.status === 'used' ? <Banner tone="info">Analysed with AI. Skills were checked against the text of the ad.</Banner>
            : <Banner tone={result.ai.status === 'error' || result.ai.status === 'consent_required' ? 'warn' : 'info'} title="Analysed on this computer with keyword rules (no AI)">{result.ai.message ?? 'Detected fields below may be incomplete — please check them.'}</Banner>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company" error={missing(form.company) ? 'Not found in the ad — please add it' : undefined}>{(id) => <Input id={id} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className={cx(missing(form.company) && 'border-warn')} />}</Field>
            <Field label="Role title" error={missing(form.title) ? 'Not found in the ad — please add it' : undefined}>{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={cx(missing(form.title) && 'border-warn')} />}</Field>
            <Field label="Role family">{(id) => <Select id={id} value={form.roleFamily} onChange={(e) => setForm({ ...form, roleFamily: e.target.value })}>{boot.roleFamilies.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>}</Field>
            <Field label="Location" hint={missing(form.location) ? 'Not stated in the ad' : undefined}>{(id) => <Input id={id} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />}</Field>
            <Field label="Applying for">{(id) => <Select id={id} value={careerType} onChange={(e) => setCareerType(e.target.value as any)}><option value="INTERNSHIP">Internship</option><option value="GRADUATE">Graduate / Entry-level</option></Select>}</Field>
            <div className="text-sm"><p className="mb-1 text-[13px] font-medium">Pay</p><p className="rounded-lg bg-surface2 px-3 py-2">{result.compensation.source === 'JOB_POST' ? <><span className="font-medium">{result.compensation.headline}</span> <span className="text-muted">· from the ad</span></> : <><span className="font-medium">Not verified</span> <span className="text-muted">· the ad states no amount</span></>}</p></div>
          </div>
          {rec && (
            <div className="rounded-lg border border-line p-3.5">
              <div className="flex flex-wrap items-center gap-2"><Chip tone={rec.tone} icon={<span aria-hidden>{rec.icon}</span>}>{rec.label}</Chip>{result.assessment.score != null && <span className="tnum text-sm"><strong>{result.assessment.score}</strong>/100 <span className="text-muted">match heuristic · {result.assessment.confidence.toLowerCase()} confidence</span></span>}</div>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">{result.assessment.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
              {result.assessment.warnings.filter((w: any) => w.severity !== 'info').map((w: any) => <div key={w.code} className="mt-2"><Banner tone={w.severity === 'high' ? 'bad' : 'warn'}>{w.text}</Banner></div>)}
            </div>
          )}
        </div>
      )}
      {manual && <ManualJob initial={{ company: selectedName(companies, companyId), title: '' }} onClose={() => setManual(false)} onSave={async (m) => {
        try { const id = await api('app.create', { companyId, company: m.company, title: m.title, careerType, jobText: text, source: 'Manual' }); await refresh(); setManual(false); onClose(); openApp(id) } catch (e) { toast('bad', errMsg(e)) }
      }} />}
    </Modal>
  )
}

const selectedName = (cs: any[], id: string | null) => cs.find((c) => c.company_id === id)?.name ?? ''

function ManualJob({ initial, onClose, onSave }: { initial: { company: string; title: string }; onClose: () => void; onSave: (v: { company: string; title: string }) => void }) {
  const [v, setV] = useState(initial)
  return (
    <Modal title="Save job manually" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!v.company.trim() || !v.title.trim()} onClick={() => onSave(v)}>Save</Button></>}>
      <p className="mb-3 text-sm text-muted">Saves the job as typed — no analysis. You can still edit it, track it and write documents later.</p>
      <div className="space-y-3"><Field label="Company">{(id) => <Input id={id} data-autofocus value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />}</Field><Field label="Role title">{(id) => <Input id={id} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field></div>
    </Modal>
  )
}
