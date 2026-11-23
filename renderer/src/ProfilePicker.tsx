import { useEffect, useState } from 'react'
import { ArrowRight, FolderInput } from 'lucide-react'
import { api, errMsg } from './api'
import type { Boot } from './ctx'
import { Logo } from './kit'
import { Button, Banner, cx, useToast } from './ui'

/** First screen, every launch: exactly two people. Adam is highlighted by default; nothing happens until someone is chosen. */
export function ProfilePicker({ boot, onPick, refresh }: { boot: Boot; onPick: (id: string) => void; refresh: () => Promise<void> }) {
  const toast = useToast()
  const people = boot.profiles.filter((p) => p.onboarding_done).sort((a, b) => (a.stable_key === 'adam' ? -1 : b.stable_key === 'adam' ? 1 : 0))
  const remembered = (() => { try { return localStorage.getItem('careerhub.lastProfile') } catch { return null } })()
  const initial = people.find((p) => p.profile_id === remembered)?.profile_id ?? people.find((p) => p.stable_key === 'adam')?.profile_id ?? people[0]?.profile_id ?? null
  const [hi, setHi] = useState<string | null>(initial)
  const [status, setStatus] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setHi(initial) }, [boot.profiles.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!people.length) api('import.status').then(setStatus).catch(() => {}) }, [people.length])

  const runImport = async () => {
    setBusy(true)
    try { await api('import.run'); await refresh() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const choose = (id: string) => { try { localStorage.setItem('careerhub.lastProfile', id) } catch { /* storage may be unavailable */ } onPick(id) }

  return (
    <main className="relative grid min-h-full place-items-center overflow-hidden px-5 py-10" aria-labelledby="who-h">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 45% at 50% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%)' }} />
      <div className="anim-fade-up relative w-full max-w-3xl">
        <div className="mb-10 flex items-center justify-center gap-2.5"><Logo size={32} /><span className="font-display text-xl font-semibold">Career Hub</span></div>
        <h1 id="who-h" className="page-title text-center !text-[2.4rem]">Who’s applying today?</h1>
        <p className="mx-auto mt-3 max-w-md text-center text-muted">Choose a profile to see Cyberjaya companies and get an email, resume and CV ready to copy or download.</p>

        {people.length > 0 ? (
          <div role="group" aria-label="Choose a profile" className="mt-9 grid gap-4 sm:grid-cols-2">
            {people.map((p) => {
              const now = p.stable_key === 'adam' || /now/i.test(p.badge)
              const active = hi === p.profile_id
              return (
                <button key={p.profile_id} data-testid={`pick-${p.stable_key ?? p.profile_id}`} autoFocus={p.profile_id === initial} onMouseEnter={() => setHi(p.profile_id)} onFocus={() => setHi(p.profile_id)} onClick={() => choose(p.profile_id)}
                  className={cx('press lift group relative flex flex-col items-start gap-5 rounded-2xl border bg-surface p-6 text-left', active ? 'border-primary shadow-lg ring-1 ring-primary' : 'border-line hover:border-line-strong')}>
                  <span className="flex w-full items-start justify-between gap-3">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft font-display text-xl font-semibold text-primary" aria-hidden>{p.name.slice(0, 1).toUpperCase()}</span>
                    <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', now ? 'bg-primary text-on-primary' : 'bg-surface2 text-muted')}>{p.badge || 'Profile'}</span>
                  </span>
                  <span>
                    <span className="font-display block text-[28px] font-semibold leading-tight">{p.name} <span className="font-normal text-muted">— {p.tagline}</span></span>
                    {p.applyPlan && <span className="mt-1.5 block text-sm text-muted">{p.applyPlan}</span>}
                  </span>
                  <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary">Open as {p.name}<ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden /></span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="mx-auto mt-9 max-w-xl">
            <Banner tone="info" title="No profiles are set up on this computer yet">
              {status?.found ? 'A private profile file was found. Import it to create the two profiles; your originals are never modified and a backup is made first.'
                : <>Career Hub reads a private file, <code className="rounded bg-surface2 px-1">profiles.payload.json</code>, that is never committed to GitHub. Place it in <code className="break-all rounded bg-surface2 px-1">{status?.expected ?? 'the app’s import folder'}</code> (or run <code className="rounded bg-surface2 px-1">npm run import:profiles</code>), then choose Import.</>}
            </Banner>
            <div className="mt-4 flex justify-center"><Button variant="primary" busy={busy} disabled={!status?.found} onClick={runImport} icon={<FolderInput size={15} aria-hidden />}>Import profiles</Button></div>
          </div>
        )}
        <p className="mt-8 text-center text-xs text-faint">Private by default. Profiles, CVs and drafts stay on this device. Career Hub never sends email.</p>
      </div>
    </main>
  )
}
