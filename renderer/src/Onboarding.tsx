import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, FolderOpen, Lock, Sparkles } from 'lucide-react'
import { api, errMsg } from './api'
import type { Boot } from './ctx'
import { Logo, SavedIndicator, useAutosave } from './kit'
import { EntryList, SkillsEditor, useFactList } from './ProfileEditors'
import { RolePicker } from './Profile'
import { Banner, Button, Chip, Field, Input, Progress, Select, Toggle, cx, useToast } from './ui'

const STEPS = [
  { key: 'about', label: 'About you', title: 'Let’s start with you', sub: 'Just the basics. Only your name is needed — everything else can wait.' },
  { key: 'study', label: 'Your studies', title: 'Where do you study?', sub: 'Add your university or college. You can add a diploma or foundation too.' },
  { key: 'skills', label: 'Roles & skills', title: 'What do you want to do — and what can you do?', sub: 'Pick the roles you’re aiming for, then list the skills you can honestly point to.' },
  { key: 'projects', label: 'Projects', title: 'What have you built?', sub: 'Projects are the best proof when you have little work history. One is enough to begin.' },
]

const emailOk = (s: string) => !s.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

export function Onboarding({ boot, refresh }: { boot: Boot; refresh: () => Promise<void> }) {
  const p = boot.profile
  const toast = useToast()
  const { facts, reload } = useFactList()
  const [step, setStep] = useState<number>(Math.min(4, Math.max(1, p.onboarding_step || 1)))
  const [done, setDone] = useState(false)
  const [identity, setIdentity] = useState<any>({ ...p.identity, fullName: p.identity.fullName ?? p.name })
  const [types, setTypes] = useState<string[]>(p.career_types.length ? p.career_types : ['INTERNSHIP'])
  const [prefs, setPrefs] = useState<any>(p.prefs)
  const [roles, setRoles] = useState({ roles: p.roles as string[], primary: p.primary_role as string | null, other: (p.other_role_text ?? '') as string })
  const [moreAbout, setMoreAbout] = useState(false)
  const [tried, setTried] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  // Steps 1 and 3 autosave; the record lists (steps 2–4) save themselves card by card.
  const basics = useAutosave({ identity, types, prefs }, (v) => api('profile.update', { identity: v.identity, career_types: v.types, prefs: v.prefs }), { ready: !!identity.fullName?.trim() })
  const roleSave = useAutosave(roles, (v) => api('profile.update', { roles: v.roles, primary_role: v.primary, other_role_text: v.other }), { ready: true })
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start' }) }, [step, done])

  const go = async (n: number) => { try { await api('profile.update', { onboarding_step: n }); setStep(n); setTried(false) } catch (e) { toast('bad', errMsg(e)) } }
  const next = async () => {
    setTried(true)
    try {
      if (step === 1) {
        if (!identity.fullName?.trim()) return toast('warn', 'Please add your full name — your documents are written with it.')
        if (!emailOk(identity.email ?? '')) return toast('warn', 'That email address doesn’t look right. Fix it, or leave it empty for now.')
        if (!types.length) return toast('warn', 'Choose Internship, Fresh graduate, or both.')
        await api('profile.update', { identity, career_types: types, prefs })
      }
      if (step === 3) {
        if (!roles.roles.length) return toast('warn', 'Choose at least one role. It decides which companies we rank for you.')
        await api('profile.update', { roles: roles.roles, primary_role: roles.primary, other_role_text: roles.other })
      }
      if (step < 4) return await go(step + 1)
      await api('profile.update', { onboarding_step: 4 }); setDone(true)
    } catch (e) { toast('bad', errMsg(e)) }
  }

  const header = (
    <div className="mb-8 flex items-center gap-2.5"><Logo size={30} /><span className="font-display text-lg font-semibold">Career Hub</span><span className="ml-auto text-sm text-muted">Hi, {(identity.fullName || p.name).split(' ')[0]}</span></div>
  )

  if (done) return <Finish boot={boot} refresh={refresh} header={header} facts={facts} />

  const S = STEPS[step - 1]
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div ref={topRef} />
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        {header}
        <nav aria-label="Setup progress" className="mb-8">
          <ol className="mb-3 grid grid-cols-4 gap-2 text-[13px]">
            {STEPS.map((s, i) => (
              <li key={s.key} aria-current={step === i + 1 ? 'step' : undefined} className={cx('flex items-center gap-1.5', step === i + 1 ? 'font-semibold text-ink' : 'text-muted')}>
                <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] transition-colors', step > i + 1 ? 'bg-ok text-on-primary' : step === i + 1 ? 'bg-primary text-on-primary' : 'bg-surface3')}>{step > i + 1 ? <Check size={12} aria-hidden /> : i + 1}</span>
                <span className="truncate">{s.label}</span>
              </li>
            ))}
          </ol>
          <Progress value={step / 4} label={`Step ${step} of 4`} />
        </nav>

        <div key={step} className="anim-fade-up flex-1">
          <div className="mb-1 flex items-center gap-2"><span className="eyebrow">Step {step} of 4</span><span className="flex-1" />{(step === 1 || step === 3) && <SavedIndicator state={step === 1 ? basics.state : roleSave.state} error={step === 1 ? basics.error : roleSave.error} />}</div>
          <h1 className="page-title">{S.title}</h1>
          <p className="mt-2 max-w-xl text-muted">{S.sub}</p>

          {step === 1 && (
            <form id="step1-form" className="mt-6 space-y-5" onSubmit={(e) => { e.preventDefault(); void next() }}>
              <div className="card grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Full name *" className="sm:col-span-2" error={tried && !identity.fullName?.trim() ? 'Required' : undefined}>{(id) => <Input id={id} autoFocus value={identity.fullName ?? ''} onChange={(e) => setIdentity({ ...identity, fullName: e.target.value })} autoComplete="name" aria-required />}</Field>
                <Field label="Email (recommended)" hint="Shown on your resume so employers can reach you." error={!emailOk(identity.email ?? '') ? 'That doesn’t look like an email address' : undefined}>{(id) => <Input id={id} type="email" value={identity.email ?? ''} onChange={(e) => setIdentity({ ...identity, email: e.target.value })} autoComplete="email" />}</Field>
                <Field label="Phone (optional)">{(id) => <Input id={id} value={identity.phone ?? ''} onChange={(e) => setIdentity({ ...identity, phone: e.target.value })} autoComplete="tel" placeholder="+60 12-345 6789" />}</Field>
                <Field label="Town or city (optional)" className="sm:col-span-2" hint="Just the area, e.g. Cyberjaya — not your full address.">{(id) => <Input id={id} value={identity.location ?? ''} onChange={(e) => setIdentity({ ...identity, location: e.target.value })} placeholder="Cyberjaya, Selangor" />}</Field>
              </div>

              <div className="card p-5">
                <h2 className="mb-2 text-sm font-semibold">What are you looking for?</h2>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Career stage">
                  <Toggle on={types.includes('INTERNSHIP')} onClick={() => setTypes((t) => t.includes('INTERNSHIP') ? t.filter((x) => x !== 'INTERNSHIP') : [...t, 'INTERNSHIP'])}>Internship</Toggle>
                  <Toggle on={types.includes('GRADUATE')} onClick={() => setTypes((t) => t.includes('GRADUATE') ? t.filter((x) => x !== 'GRADUATE') : [...t, 'GRADUATE'])}>Fresh graduate / early career</Toggle>
                </div>
                <button type="button" onClick={() => setMoreAbout(!moreAbout)} aria-expanded={moreAbout} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><ChevronRight size={14} className={cx('transition-transform', moreAbout && 'rotate-90')} aria-hidden />Links and availability (optional)</button>
                {moreAbout && (
                  <div className="anim-fade mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="GitHub">{(id) => <Input id={id} value={identity.github ?? ''} onChange={(e) => setIdentity({ ...identity, github: e.target.value })} placeholder="https://github.com/you" />}</Field>
                    <Field label="LinkedIn">{(id) => <Input id={id} value={identity.linkedin ?? ''} onChange={(e) => setIdentity({ ...identity, linkedin: e.target.value })} placeholder="https://linkedin.com/in/you" />}</Field>
                    <Field label="Portfolio" className="sm:col-span-2">{(id) => <Input id={id} value={identity.portfolio ?? ''} onChange={(e) => setIdentity({ ...identity, portfolio: e.target.value })} />}</Field>
                    <Field label="Internship starts" hint="e.g. March 2027">{(id) => <Input id={id} value={prefs.internshipStart ?? ''} onChange={(e) => setPrefs({ ...prefs, internshipStart: e.target.value })} placeholder="March 2027" />}</Field>
                    <Field label="Internship ends">{(id) => <Input id={id} value={prefs.internshipEnd ?? ''} onChange={(e) => setPrefs({ ...prefs, internshipEnd: e.target.value })} placeholder="August 2027" />}</Field>
                    <Field label="Work style">{(id) => <Select id={id} value={prefs.workMode ?? ''} onChange={(e) => setPrefs({ ...prefs, workMode: e.target.value })}><option value="">No preference</option><option value="onsite">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></Select>}</Field>
                  </div>
                )}
              </div>
              <p className="flex items-start gap-2 text-sm text-muted"><Lock size={15} className="mt-0.5 shrink-0" aria-hidden />Career Hub never asks for your IC number, home address, date of birth, gender or a photo. Everything stays on this computer.</p>
            </form>
          )}

          {step === 2 && (
            <div className="mt-6 space-y-6">
              <EntryList category="EDUCATION" facts={facts} onChanged={reload} />
              <details className="card px-5 py-3"><summary className="text-sm font-semibold">Honours &amp; awards <span className="font-normal text-muted">(optional) — Dean’s List, scholarships…</span></summary><div className="mt-3"><EntryList category="AWARD" facts={facts} onChanged={reload} /></div></details>
            </div>
          )}

          {step === 3 && (
            <div className="mt-6 space-y-6">
              <section className="card p-5"><h2 className="mb-1 font-semibold">Target roles *</h2><p className="mb-3 text-sm text-muted">Pick as many as you like. Mark one as your main focus.</p>
                <RolePicker roleFamilies={boot.roleFamilies} roles={roles.roles} primary={roles.primary} other={roles.other} onChange={setRoles} />
                {tried && !roles.roles.length && <p role="alert" className="mt-2 text-sm text-bad">Choose at least one role.</p>}
              </section>
              <section className="card p-5"><h2 className="mb-1 font-semibold">Your skills</h2><p className="mb-4 text-sm text-muted">Type to search or add your own. Skills only — activities and awards go elsewhere. Fill in what applies; skip the rest.</p><SkillsEditor facts={facts} onChanged={reload} /></section>
            </div>
          )}

          {step === 4 && (
            <div className="mt-6 space-y-6">
              <EntryList category="PROJECT" facts={facts} onChanged={reload} />
              <div className="space-y-2">
                <p className="eyebrow">More you can add (all optional)</p>
                <details className="card px-5 py-3"><summary className="text-sm font-semibold">Work or internship experience</summary><div className="mt-3"><EntryList category="EXPERIENCE" facts={facts} onChanged={reload} /></div></details>
                <details className="card px-5 py-3"><summary className="text-sm font-semibold">Clubs, leadership &amp; volunteering</summary><div className="mt-3"><EntryList category="LEADERSHIP" facts={facts} onChanged={reload} /></div></details>
                <details className="card px-5 py-3"><summary className="text-sm font-semibold">Certifications</summary><div className="mt-3"><EntryList category="CERTIFICATION" facts={facts} onChanged={reload} /></div></details>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 -mx-4 mt-8 flex items-center gap-3 border-t border-line bg-bg/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
          {step > 1 ? <Button variant="ghost" onClick={() => go(step - 1)} icon={<ArrowLeft size={15} aria-hidden />}>Back</Button> : <span />}
          <span className="flex-1" />
          {step > 1 && <button onClick={() => (step < 4 ? go(step + 1) : setDone(true))} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">I’ll add this later</button>}
          <Button variant="primary" {...(step === 1 ? { type: "submit" as const, form: "step1-form" } : { onClick: next })} icon={step === 4 ? <Check size={15} aria-hidden /> : <ArrowRight size={15} aria-hidden />}>{step === 4 ? 'Finish setup' : 'Continue'}</Button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ completion: one calm celebration, folder approval, hand-off to Companies
function Finish({ boot, refresh, header, facts }: { boot: Boot; refresh: () => Promise<void>; header: React.ReactNode; facts: any[] }) {
  const toast = useToast()
  const [root, setRoot] = useState<string | null>(boot.profile.storage_root)
  const [busy, setBusy] = useState(false)
  const [c, setC] = useState<any>(null)
  useEffect(() => { api('profile.completion').then(setC).catch(() => {}) }, [])
  const n = (cat: string) => facts.filter((f) => f.category === cat).length
  const chooseFolder = async (path?: string) => {
    setBusy(true)
    try { const chosen = path ?? await api('folder.choose'); if (!chosen) return; const r = await api('folder.set', { path: chosen }); setRoot(r.root) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const enter = async () => { setBusy(true); try { await api('profile.update', { onboarding_done: true, onboarding_step: 4 }); await refresh() } catch (e) { toast('bad', errMsg(e)); setBusy(false) } }
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 py-10 sm:px-6">
        {header}
        <div className="anim-fade-up">
          <div className="anim-pop mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary"><Sparkles size={26} aria-hidden /></div>
          <h1 className="page-title">You’re set up, {(boot.profile.identity.fullName || boot.profile.name).split(' ')[0]}.</h1>
          <p className="mt-2 text-muted">Career Hub now knows enough to rank Cyberjaya companies for you. You can add or change anything later in My Profile.</p>

          <div className="card mt-6 p-5">
            <div className="flex flex-wrap gap-2">
              <Chip tone={n('EDUCATION') ? 'ok' : 'neutral'}>{n('EDUCATION')} education</Chip><Chip tone={n('SKILL') ? 'ok' : 'neutral'}>{n('SKILL')} skill groups</Chip><Chip tone={n('PROJECT') ? 'ok' : 'neutral'}>{n('PROJECT')} projects</Chip>
              <Chip>{n('EXPERIENCE') + n('LEADERSHIP')} experience &amp; activities</Chip>
            </div>
            {c && (c.ready
              ? <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-ok"><Check size={16} aria-hidden />Ready to tailor applications.</p>
              : <p className="mt-3 text-sm text-muted"><span className="font-medium text-ink">Next best step:</span> {c.next?.hint} <span className="text-faint">({c.requiredDone} of {c.requiredTotal} basics done)</span></p>)}
          </div>

          <div className="card mt-4 p-5">
            <div className="flex items-start gap-3"><FolderOpen className="mt-0.5 text-primary" size={20} aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">Where should your applications be saved?</h2>
                <p className="mt-0.5 text-sm text-muted">Career Hub only writes inside a folder you approve, in a separate sub-folder for each person and company.</p>
                {root ? <p data-testid="root-path" className="mt-2 break-all rounded-lg bg-surface2 px-3 py-2 text-sm">{root}</p> : <p className="mt-2 text-sm text-muted">Suggested: <code className="rounded bg-surface2 px-1.5 py-0.5 text-xs">{boot.defaultFolder}</code></p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!root && <Button busy={busy} onClick={() => chooseFolder(boot.defaultFolder.replace(/[\\/]Career Hub$/, ''))}>Use the suggested folder</Button>}
                  <Button busy={busy} onClick={() => chooseFolder()}>{root ? 'Change folder…' : 'Choose another folder…'}</Button>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted">Profiles are separate inside this app but not locked at operating-system level: anyone using your computer account could open the data. For stronger privacy, use separate Windows/macOS user accounts.</p>
          {!root && <div className="mt-4"><Banner tone="info">You can pick a folder later — it’s needed the first time you save a document.</Banner></div>}
          <div className="mt-7"><Button variant="primary" busy={busy} onClick={enter} icon={<ArrowRight size={15} aria-hidden />} className="h-11 px-5 text-[15px]">Explore Cyberjaya companies</Button></div>
        </div>
      </div>
    </div>
  )
}
