import { useState } from 'react'
import { ArrowLeft, ArrowRight, Briefcase, Check, FolderOpen, ShieldCheck, Upload } from 'lucide-react'
import { api, errMsg } from './api'
import type { Boot } from './ctx'
import { AiFields, type AiForm } from './Settings'
import { FactsReview, IdentityFields, PrefsFields, RolePicker } from './Profile'
import { Banner, Button, Chip, Field, Input, Progress, Toggle, cx, useAsync, useToast } from './ui'

const STEPS = ['Your role', 'Your CV', 'Your folder']

export function Onboarding({ boot, refresh }: { boot: Boot; refresh: () => Promise<void> }) {
  const p = boot.profile
  const toast = useToast()
  const [step, setStep] = useState<number>(Math.min(3, Math.max(1, p.onboarding_step || 1)))
  const [roles, setRoles] = useState({ roles: p.roles as string[], primary: p.primary_role as string | null, other: (p.other_role_text ?? '') as string })
  const [types, setTypes] = useState<string[]>(p.career_types)
  const [region, setRegion] = useState<string>(p.region)
  const [prefs, setPrefs] = useState<any>(p.prefs)
  const [more, setMore] = useState(false)
  const [identity, setIdentity] = useState<any>(p.identity)
  const [busy, setBusy] = useState(false)
  const [cvNote, setCvNote] = useState<any>(null)
  const [skippedCv, setSkippedCv] = useState(false)
  const [root, setRoot] = useState<string | null>(p.storage_root)
  const [ai, setAi] = useState<AiForm>({ provider: '', model: '', baseUrl: '', apiKey: '', redact: false, consent: false })
  const facts = useAsync(() => api('facts.list'), [step, cvNote])

  const go = async (n: number, patch: any = {}) => { await api('profile.update', { onboarding_step: n, ...patch }); setStep(n) }
  const step1 = async () => {
    if (!roles.roles.length) return toast('warn', 'Choose at least one role to continue.')
    if (roles.roles.includes('other') && roles.roles.length === 1 && !roles.other.trim()) return toast('warn', 'Describe the other role, or pick one from the list.')
    if (!types.length) return toast('warn', 'Choose Internship, Graduate / Entry-level, or both.')
    setBusy(true)
    try { await go(2, { roles: roles.roles, primary_role: roles.primary, other_role_text: roles.other, career_types: types, region: region || 'Cyberjaya', prefs }) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const importFile = async (path: string | null) => {
    if (!path) return
    setBusy(true)
    try { const r = await api('cv.import', { path }); setCvNote(r); setIdentity(r.identity); await refresh() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const pick = async () => { try { await importFile(await api('cv.pick')) } catch (e) { toast('bad', errMsg(e)) } }
  const step2 = async () => { setBusy(true); try { await go(3, { identity }) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const chooseFolder = async (path?: string) => {
    setBusy(true)
    try { const chosen = path ?? await api('folder.choose'); if (!chosen) return; const r = await api('folder.set', { path: chosen }); setRoot(r.root); await refresh() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const finish = async () => {
    setBusy(true)
    try {
      if (ai.provider) await api('ai.set', { provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl, apiKey: ai.apiKey, redact: ai.redact, consent: ai.consent })
      await api('profile.update', { onboarding_done: true, onboarding_step: 3 }); await refresh()
    } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }

  const confirmedCount = (facts.data ?? []).filter((f: any) => f.confirmed).length
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 flex items-center gap-2.5"><div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-on-primary"><Briefcase size={16} aria-hidden /></div><span className="font-semibold tracking-tight">Career Hub</span><span className="ml-auto text-sm text-muted">Hi, {p.name.split(' ')[0]}</span></div>
        <nav aria-label="Setup progress" className="mb-8">
          <ol className="mb-2.5 flex justify-between text-[13px]">
            {STEPS.map((s, i) => <li key={s} aria-current={step === i + 1 ? 'step' : undefined} className={cx('flex items-center gap-1.5', step === i + 1 ? 'font-semibold text-ink' : 'text-muted')}><span className={cx('grid h-5 w-5 place-items-center rounded-full text-[11px]', step > i + 1 ? 'bg-ok text-on-primary' : step === i + 1 ? 'bg-primary text-on-primary' : 'bg-surface2')}>{step > i + 1 ? <Check size={12} aria-hidden /> : i + 1}</span>{s}</li>)}
          </ol>
          <Progress value={step / 3} label={`Step ${step} of 3`} />
        </nav>

        <div key={step} className="anim-fade-up flex-1">
          {step === 1 && (
            <section>
              <h1 className="text-2xl font-semibold tracking-tight">What kind of CS role are you targeting?</h1>
              <p className="mt-1.5 text-muted">Pick one or more. This shapes which companies, matches and wording you see — you can change it any time.</p>
              <div className="mt-5"><RolePicker roleFamilies={boot.roleFamilies} roles={roles.roles} primary={roles.primary} other={roles.other} onChange={setRoles} /></div>
              <h2 className="mb-2 mt-7 text-sm font-semibold">What are you applying for?</h2>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Career stage">
                <Toggle on={types.includes('INTERNSHIP')} onClick={() => setTypes((t) => t.includes('INTERNSHIP') ? t.filter((x) => x !== 'INTERNSHIP') : [...t, 'INTERNSHIP'])}>Internship</Toggle>
                <Toggle on={types.includes('GRADUATE')} onClick={() => setTypes((t) => t.includes('GRADUATE') ? t.filter((x) => x !== 'GRADUATE') : [...t, 'GRADUATE'])}>Graduate / Entry-level</Toggle>
              </div>
              <Field className="mt-5 max-w-xs" label="Where?" hint="Cyberjaya is the default focus. You can still add jobs elsewhere.">{(id) => <Input id={id} value={region} onChange={(e) => setRegion(e.target.value)} />}</Field>
              <button onClick={() => setMore(!more)} aria-expanded={more} className="mt-5 text-sm font-medium text-primary hover:underline">{more ? 'Hide optional details' : 'Add optional details (dates, university, expectations)'}</button>
              {more && <div className="anim-fade mt-3 rounded-xl border border-line bg-surface p-4"><PrefsFields prefs={prefs} onChange={setPrefs} /></div>}
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className="text-2xl font-semibold tracking-tight">Add your master CV</h1>
              <p className="mt-1.5 text-muted">Drop a PDF or Word file. We read it on this computer and keep your original untouched. Nothing is sent anywhere.</p>
              {!cvNote && (
                <div role="button" tabIndex={0} aria-label="Choose your CV file" data-testid="cv-drop"
                  onClick={pick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void pick() } }}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void importFile(window.careerHub.pathForFile(f)) }}
                  className="mt-5 grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line-strong bg-surface px-6 py-12 text-center transition-colors hover:border-primary hover:bg-primary-soft/40">
                  <Upload size={26} className="mb-2 text-primary" aria-hidden /><p className="font-medium">{busy ? 'Reading your CV…' : 'Drop your CV here, or click to choose'}</p><p className="mt-1 text-sm text-muted">PDF or DOCX · text-based files work best</p>
                </div>
              )}
              {cvNote && (
                <div className="mt-5 space-y-4">
                  {cvNote.duplicate && <Banner tone="info" title="Duplicate detected">{cvNote.duplicate_of}</Banner>}
                  {cvNote.warnings.map((w: string) => <Banner key={w} tone="warn">{w}</Banner>)}
                  <div><h2 className="mb-2 font-semibold">We found these details — please check them</h2><p className="mb-3 text-sm text-muted">Automatic reading can be wrong. Nothing is used in your documents until you confirm it.</p>
                    <div className="rounded-xl border border-line bg-surface p-4"><h3 className="mb-2 text-sm font-semibold">Contact</h3><IdentityFields identity={identity} onChange={setIdentity} /></div></div>
                  <FactsReview compact facts={facts.data ?? []} reload={facts.reload} />
                </div>
              )}
              {cvNote && <button onClick={() => { setCvNote(null) }} className="mt-3 text-sm text-primary hover:underline">Choose a different file</button>}
              {!cvNote && <button onClick={() => { setSkippedCv(true); void step2() }} className="mt-4 text-sm text-muted underline-offset-2 hover:underline">Skip for now — I’ll fill in my profile by hand</button>}
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 className="text-2xl font-semibold tracking-tight">Where should applications be saved?</h1>
              <p className="mt-1.5 text-muted">Career Hub creates a folder only after you choose one, and never writes outside it.</p>
              <div className="mt-5 rounded-xl border border-line bg-surface p-4">
                {root ? (
                  <div className="flex items-start gap-3"><FolderOpen className="mt-0.5 text-ok" size={20} aria-hidden /><div className="min-w-0"><p className="font-medium">Saved to</p><p data-testid="root-path" className="break-all text-sm text-muted">{root}</p><p className="mt-2 text-xs text-faint">Profiles / {p.name} / Applications / Company__Role__ID / resume, cover letter, .eml, notes</p></div></div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2"><Button variant="primary" busy={busy} onClick={() => chooseFolder()} icon={<FolderOpen size={16} aria-hidden />}>Choose folder…</Button><Button busy={busy} onClick={() => chooseFolder(boot.defaultFolder.replace(/[\\/]Career Hub$/, ''))}>Use Documents</Button><span className="text-sm text-muted">Suggested: <code className="rounded bg-surface2 px-1.5 py-0.5 text-xs">{boot.defaultFolder}</code></span></div>
                )}
                {root && <Button className="mt-3" size="sm" onClick={() => chooseFolder()}>Change folder</Button>}
              </div>

              <div className="mt-6 rounded-xl border border-line bg-surface p-4">
                <div className="mb-1 flex items-center gap-2"><ShieldCheck size={17} className="text-primary" aria-hidden /><h2 className="font-semibold">AI assistant <span className="font-normal text-muted">(optional)</span></h2></div>
                <p className="mb-3 text-sm text-muted">Everything except AI wording works without it. You can set this up later in Settings.</p>
                <AiFields value={ai} onChange={setAi} secureStorage={boot.secureKeyStorage} compact />
              </div>
              {confirmedCount === 0 && !skippedCv && <div className="mt-4"><Banner tone="warn" title="No confirmed facts yet">You can still finish, but documents can’t be generated until you confirm details in My Profile.</Banner></div>}
            </section>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
          {step > 1 ? <Button variant="ghost" onClick={() => go(step - 1)} icon={<ArrowLeft size={15} aria-hidden />}>Back</Button> : <span />}
          {step === 1 && <Button variant="primary" busy={busy} onClick={step1} icon={<ArrowRight size={15} aria-hidden />}>Continue</Button>}
          {step === 2 && cvNote && <Button variant="primary" busy={busy} onClick={step2} icon={<ArrowRight size={15} aria-hidden />}>{confirmedCount ? 'Continue' : 'Continue without confirming'}</Button>}
          {step === 3 && <Button variant="primary" busy={busy} disabled={!root} onClick={finish} icon={<Check size={15} aria-hidden />}>Finish & open dashboard</Button>}
        </div>
      </div>
    </div>
  )
}
