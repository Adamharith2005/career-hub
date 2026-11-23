import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, FileText, FolderOpen, Mail } from 'lucide-react'
import { api, errMsg, REC } from './api'
import { roleName, useApp, type PrepareOpts } from './ctx'
import { ScoreRing, bandIcon, bandOf } from './kit'
import { Banner, Button, Chip, Field, Input, Modal, Progress, Select, Spinner, Textarea, cx, useToast } from './ui'

type Route = 'enquiry' | 'vacancy'
const ROLE_NOUN: Record<string, string> = { swe: 'Software Engineering', frontend: 'Frontend', backend: 'Backend', ai_ml: 'AI / Machine Learning', data: 'Data', cyber: 'Cybersecurity', cloud_devops: 'Cloud / DevOps', qa: 'QA / Testing', it_support: 'IT Support', other: 'Technology' }

/** One guided flow: confirm company + role → choose how you’re approaching them → see fit and plan → generate drafts. Drafts only: nothing is sent and nothing is marked Applied. */
export function PrepareApplication({ opts, onClose }: { opts: PrepareOpts; onClose: () => void }) {
  const { boot, refresh, openApp } = useApp()
  const toast = useToast()
  const p = boot.profile
  const [c, setC] = useState<any>(null)
  const [step, setStep] = useState(1)
  const [roleFamily, setRoleFamily] = useState('swe')
  const [title, setTitle] = useState('')
  const [careerType, setCareerType] = useState<'INTERNSHIP' | 'GRADUATE'>(p.career_types.includes('INTERNSHIP') ? 'INTERNSHIP' : 'GRADUATE')
  const [route, setRoute] = useState<Route>('enquiry')
  const [jd, setJd] = useState('')
  const [analysis, setAnalysis] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [issues, setIssues] = useState<any[] | null>(null)
  const [root, setRoot] = useState<string | null>(p.storage_root)
  const [completion, setCompletion] = useState<any>(null)

  useEffect(() => {
    api('companies.get', { id: opts.companyId, focusRoles: opts.focusRoles }).then((d) => {
      setC(d)
      const fams: string[] = d.role_families.filter((r: string) => r !== 'other')
      const mine = ((opts.focusRoles?.length ? opts.focusRoles : p.roles) as string[])
      const pick = mine.find((r) => fams.includes(r)) ?? (p.primary_role && fams.includes(p.primary_role) ? p.primary_role : fams[0]) ?? p.primary_role ?? 'swe'
      setRoleFamily(pick)
      setRoute(d.status_enum === 'VERIFIED_ACTIVE_VACANCY' ? 'vacancy' : 'enquiry')
    }).catch((e) => toast('bad', errMsg(e)))
    api('profile.completion').then(setCompletion).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.companyId])
  useEffect(() => { setTitle(`${ROLE_NOUN[roleFamily] ?? 'Technology'} ${careerType === 'INTERNSHIP' ? 'Intern' : 'Graduate'}`) }, [roleFamily, careerType])
  const fams = useMemo(() => (c?.role_families ?? []).filter((r: string) => r !== 'other'), [c])
  const options = useMemo(() => [...new Set([...(p.roles as string[]).filter((r) => r !== 'other'), ...fams])], [fams, p.roles])

  const toPlan = async () => {
    if (!title.trim()) return toast('warn', 'Add a role title first.')
    if (route === 'vacancy') {
      if (jd.trim().length < 40) return toast('warn', 'Paste the full job description (a few lines at least), or choose “Ask about internships”.')
      setBusy(true)
      try { setAnalysis(await api('job.analyze', { text: jd, companyId: c.company_id, careerType, company: c.name, title })) } catch (e) { toast('bad', errMsg(e)); setBusy(false); return }
      setBusy(false)
    } else setAnalysis(null)
    setStep(2)
  }
  const chooseFolder = async () => {
    try { const chosen = await api('folder.choose'); if (!chosen) return; const r = await api('folder.set', { path: chosen }); setRoot(r.root); await refresh() } catch (e) { toast('bad', errMsg(e)) }
  }
  const generate = async () => {
    setBusy(true); setIssues(null); setStep(3)
    try {
      const appId = await api('app.create', route === 'vacancy' && analysis
        ? { companyId: c.company_id, company: c.name, title, roleFamily, careerType, mode: 'ADVERTISED_VACANCY', jobText: jd, analysis: { spec: { ...analysis.spec, roleFamily, company: c.name, title }, assessment: analysis.assessment, compensation: analysis.compensation }, source: 'Cyberjaya directory + pasted job ad' }
        : { companyId: c.company_id, company: c.name, title, roleFamily, careerType, mode: 'SPECULATIVE_OUTREACH', source: 'Cyberjaya directory (speculative enquiry)' })
      const r = await api('docs.generate', { appId })
      await refresh()
      if (!r.ok) { setIssues(r.issues); setResult({ appId, ok: false }) } else setResult({ appId, ok: true, ...r })
    } catch (e) { toast('bad', errMsg(e)); setStep(2) } finally { setBusy(false) }
  }

  const fit = c?.fit
  const band = bandOf(fit?.label)
  const labels = ['Role & route', 'Fit & plan', 'Drafts']
  return (
    <Modal wide title={c ? `Prepare an application — ${c.name}` : 'Prepare an application'} onClose={onClose}
      footer={step === 1 ? <><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!c} onClick={toPlan} icon={<ArrowRight size={15} aria-hidden />}>Continue</Button></>
        : step === 2 ? <><Button onClick={() => setStep(1)}>Back</Button><Button variant="primary" onClick={generate} disabled={!root} title={root ? undefined : 'Choose a save folder first'} icon={<FileText size={15} aria-hidden />}>Create tailored drafts</Button></>
          : result?.ok ? <><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={() => { onClose(); openApp(result.appId, 'documents') }}>Review documents</Button></>
            : issues ? <><Button onClick={() => setStep(2)}>Back</Button><Button variant="primary" onClick={() => { onClose(); openApp(result.appId) }}>Open application</Button></> : null}>
      {!c ? <Spinner /> : (
        <div>
          <ol className="mb-5 flex items-center gap-2 text-[13px]" aria-label="Steps">
            {labels.map((l, i) => <li key={l} aria-current={step === i + 1 ? 'step' : undefined} className={cx('flex items-center gap-1.5', step === i + 1 ? 'font-semibold' : 'text-muted')}><span className={cx('grid h-5 w-5 place-items-center rounded-full text-[11px]', step > i + 1 ? 'bg-ok text-on-primary' : step === i + 1 ? 'bg-primary text-on-primary' : 'bg-surface3')}>{step > i + 1 ? <Check size={11} aria-hidden /> : i + 1}</span>{l}{i < 2 && <span className="mx-1 text-faint" aria-hidden>›</span>}</li>)}
          </ol>

          {step === 1 && (
            <div className="anim-fade space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company">{() => <div className="rounded-lg bg-surface2 px-3 py-2 text-sm font-medium">{c.name}</div>}</Field>
                <Field label="Role area">{(id) => <Select id={id} value={roleFamily} onChange={(e) => setRoleFamily(e.target.value)}>{options.map((r) => <option key={r} value={r}>{roleName(boot, r)}{fams.includes(r) ? '' : ' (not listed for this company)'}</option>)}</Select>}</Field>
                <Field label="Role title" className="sm:col-span-1">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
                <Field label="Applying for">{(id) => <Select id={id} value={careerType} onChange={(e) => setCareerType(e.target.value as any)}><option value="INTERNSHIP">Internship</option><option value="GRADUATE">Fresh graduate / early career</option></Select>}</Field>
              </div>
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium">How are you approaching them?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([['enquiry', 'Ask about internships', 'A short, clearly-labelled enquiry. Right when no opening is advertised.'], ['vacancy', 'Use a vacancy I found', 'Paste the job description so the drafts and fit use the real requirements.']] as const).map(([k, h, d]) => (
                    <label key={k} className={cx('press cursor-pointer rounded-xl border p-3.5', route === k ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-line hover:border-line-strong')}>
                      <input type="radio" name="route" className="sr-only" checked={route === k} onChange={() => setRoute(k)} /><span className="block font-semibold">{h}</span><span className="mt-0.5 block text-sm text-muted">{d}</span>
                    </label>))}
                </div>
              </fieldset>
              {c.fit.vacancy.state === 'NOT_VERIFIED' && route === 'enquiry' && <Banner tone="info">{c.fit.vacancy.headline}. The drafts will say this is an enquiry, never an application for an opening.</Banner>}
              {c.fit.vacancy.state === 'HISTORICAL_LISTING' && <Banner tone="info" title="A listing was recorded in research">{c.fit.vacancy.detail}</Banner>}
              {route === 'vacancy' && <Field label="Job description" hint="Public text you copied from the careers page. It’s analysed on this computer unless you’ve enabled AI.">{(id) => <Textarea id={id} rows={8} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job ad here…" />}</Field>}
            </div>
          )}

          {step === 2 && (
            <div className="anim-fade space-y-4">
              <section className="card-soft p-4">
                <p className="eyebrow mb-2">Target fit — {c.name} overall</p>
                {fit.status === 'scored'
                  ? <div className="flex items-center gap-3"><ScoreRing score={fit.score} label={fit.label} size={52} /><div><p className="font-semibold"><span aria-hidden>{bandIcon(band)} </span>{fit.label}</p><p className="text-sm text-muted">{fit.reasons[0]}</p></div></div>
                  : <p className="text-sm text-muted">Not enough profile information yet — {fit.missingProfile.join(' · ')}.</p>}
              </section>
              {analysis && (
                <section className="card-soft p-4">
                  <p className="eyebrow mb-2">Vacancy fit — this job description</p>
                  <div className="flex flex-wrap items-center gap-2"><Chip tone={REC[analysis.assessment.recommendation].tone} icon={<span aria-hidden>{REC[analysis.assessment.recommendation].icon}</span>}>{REC[analysis.assessment.recommendation].label}</Chip>{analysis.assessment.score != null && <span className="tnum text-sm"><strong>{analysis.assessment.score}</strong>/100 <span className="text-muted">· {analysis.assessment.confidence.toLowerCase()} confidence</span></span>}</div>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">{analysis.assessment.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
                  {analysis.assessment.missing?.length > 0 && <p className="mt-2 text-sm"><span className="font-medium">Required skills you haven’t listed:</span> <span className="text-muted">{analysis.assessment.missing.join(', ')}. They won’t be added to your resume.</span></p>}
                  {analysis.assessment.gates.filter((g: any) => g.status !== 'met').map((g: any) => <div key={g.text} className="mt-2"><Banner tone={g.status === 'failed' ? 'bad' : 'warn'} title="Eligibility">{g.note}</Banner></div>)}
                </section>
              )}
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="card-soft p-3.5"><p className="eyebrow mb-1">Resume will lead with</p><p className="text-sm">{fit.status === 'scored' ? fit.resumeAngle.text : 'Your most relevant projects and skills, in order of relevance.'}</p></div>
                <div className="card-soft p-3.5"><p className="eyebrow mb-1">Suggested approach</p><p className="text-sm">{route === 'enquiry' ? fit.outreachAngle : 'Apply through the official channel using the documents below; email only if you have a verified address.'}</p></div>
              </section>
              {fit.gaps?.length > 0 && <p className="text-sm text-muted"><span className="font-medium text-ink">Could strengthen:</span> {fit.gaps.slice(0, 3).join(' · ')}</p>}
              <section className="card p-4">
                <p className="eyebrow mb-2">Application readiness — your material</p>
                <ul className="space-y-1.5 text-sm">
                  <li className="flex items-center gap-2">{completion?.ready ? <Check size={15} className="text-ok" aria-hidden /> : <AlertTriangle size={15} className="text-warn" aria-hidden />}{completion?.ready ? 'Profile has the basics for a tailored resume.' : `Profile is thin: ${completion?.next?.hint ?? 'add more details'} Drafts will be honestly sparse.`}</li>
                  <li className="flex items-center gap-2">{root ? <Check size={15} className="text-ok" aria-hidden /> : <AlertTriangle size={15} className="text-warn" aria-hidden />}{root ? <>Saving to <span className="break-all text-muted">{root}</span></> : <>No save folder chosen yet. <Button size="sm" onClick={chooseFolder} icon={<FolderOpen size={13} aria-hidden />}>Choose folder</Button></>}</li>
                </ul>
              </section>
              <p className="text-xs text-muted">Creating drafts saves a resume, cover letter and email wording on this computer. Nothing is sent, and the application stays unsent until you mark it yourself.</p>
            </div>
          )}

          {step === 3 && (
            <div className="anim-fade">
              {busy && <div className="py-6"><Progress value={0.6} label="Creating drafts" /><p className="mt-3 text-sm text-muted">Selecting your most relevant projects and writing the drafts…</p></div>}
              {!busy && result?.ok && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3"><div className="anim-pop grid h-11 w-11 place-items-center rounded-full bg-ok-bg text-ok"><Check size={22} aria-hidden /></div><div><p className="text-lg font-semibold">Drafts are ready to review</p><p className="text-sm text-muted">Saved in a new folder for {c.name}. Earlier versions are never overwritten.</p></div></div>
                  <ul className="card divide-y divide-line text-sm">
                    {[['Tailored resume', result.resume], ['Cover letter', result.letter]].map(([n, d]: any) => <li key={n} className="flex items-center gap-2 px-3.5 py-2.5"><FileText size={15} className="text-muted" aria-hidden /><span className="flex-1 font-medium">{n} <span className="font-normal text-muted">v{String(d.version).padStart(2, '0')}</span></span>{d.qa.passed ? <Chip tone="ok" icon={<Check size={11} aria-hidden />}>Checks passed</Chip> : <Chip tone="warn" icon={<AlertTriangle size={11} aria-hidden />}>Needs a look</Chip>}</li>)}
                    <li className="flex items-center gap-2 px-3.5 py-2.5"><Mail size={15} className="text-muted" aria-hidden /><span className="flex-1">Email wording is ready in the Email tab — a draft you copy yourself.</span></li>
                  </ul>
                  {[result.resume, result.letter].some((d: any) => !d.qa.passed) && <Banner tone="warn" title="Some checks need attention">Open the Documents tab to see exactly what to fix.</Banner>}
                  <div className="flex flex-wrap gap-2"><Button onClick={async () => { try { await api('fs.openAppFolder', { appId: result.appId }) } catch (e) { toast('bad', errMsg(e)) } }} icon={<FolderOpen size={14} aria-hidden />}>Open folder</Button><Button onClick={() => { onClose(); openApp(result.appId, 'email') }} icon={<Mail size={14} aria-hidden />}>View email draft</Button></div>
                </div>
              )}
              {!busy && issues && (
                <div className="space-y-3"><Banner tone="warn" title="A draft was blocked to protect you from unsupported claims">Career Hub only uses details you’ve confirmed. Fix these in My Profile, then try again.</Banner>
                  <ul className="list-disc space-y-1 pl-5 text-sm">{issues.slice(0, 6).map((i: any, k: number) => <li key={k}>{i.message}</li>)}</ul></div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
