import { useCallback, useEffect, useRef, useState } from 'react'
import { Briefcase, Building2, ChevronsUpDown, Home as HomeIcon, ListChecks, Plus, Settings as SettingsIcon, UserRound } from 'lucide-react'
import { api, errMsg } from './api'
import { Ctx, type Boot, type NewAppOpts, type Page } from './ctx'
import { Button, Input, Field, Spinner, ToastHost, cx, useToast } from './ui'
import { Onboarding } from './Onboarding'
import { HomePage, ApplicationsPage } from './Applications'
import { AppDetail } from './AppDetail'
import { NewApplication } from './NewApplication'
import { CompaniesPage } from './Companies'
import { ProfilePage } from './Profile'
import { SettingsPage } from './Settings'

const NAV: { key: Page; label: string; icon: typeof HomeIcon }[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'applications', label: 'Applications', icon: ListChecks },
  { key: 'companies', label: 'Companies', icon: Building2 },
  { key: 'profile', label: 'My Profile', icon: UserRound },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
]

export function App() { return <ToastHost><Root /></ToastHost> }

function Root() {
  const toast = useToast()
  const [boot, setBoot] = useState<Boot | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('home')
  const [detail, setDetail] = useState<{ id: string; tab?: string } | null>(null)
  const [newOpts, setNewOpts] = useState<NewAppOpts | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(async () => {
    try { setBoot(await api('boot')); setTick((t) => t + 1) } catch (e) { setFatal(errMsg(e)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  // theme
  const theme = boot?.profile?.prefs?.theme ?? 'system'
  useEffect(() => { const r = document.documentElement; if (theme === 'system') r.removeAttribute('data-theme'); else r.dataset.theme = theme }, [theme])

  if (fatal) return <div role="alert" className="m-auto max-w-md p-10 text-center"><h1 className="text-lg font-semibold">Career Hub could not start</h1><p className="mt-2 text-muted">{fatal}</p></div>
  if (!boot) return <div className="grid h-full place-items-center"><Spinner label="Opening Career Hub" /></div>
  if (!boot.profile) return <CreateProfile onDone={refresh} />
  if (!boot.profile.onboarding_done) return <Onboarding boot={boot} refresh={refresh} />

  const ctx = {
    boot, refresh, tick,
    go: (p: Page) => { setDetail(null); setPage(p) },
    openApp: (id: string, tab?: string) => setDetail({ id, tab }),
    newApp: (o: NewAppOpts = {}) => setNewOpts(o),
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full flex-col md:flex-row">
        <Sidebar boot={boot} page={detail ? 'applications' : page} onNav={ctx.go} onNew={() => ctx.newApp()} onSwitch={async (id) => { await api('profile.switch', { id }); setDetail(null); setPage('home'); await refresh() }} onAdd={async (name) => { try { await api('profile.create', { name }); setDetail(null); setPage('home'); await refresh() } catch (e) { toast('bad', errMsg(e)) } }} />
        <main id="main" className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div key={detail ? `d-${detail.id}` : page} className="anim-fade-up mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-8 sm:py-7">
            {detail ? <AppDetail id={detail.id} initialTab={detail.tab} onBack={() => setDetail(null)} />
              : page === 'home' ? <HomePage />
              : page === 'applications' ? <ApplicationsPage />
              : page === 'companies' ? <CompaniesPage />
              : page === 'profile' ? <ProfilePage />
              : <SettingsPage />}
          </div>
        </main>
      </div>
      {newOpts && <NewApplication opts={newOpts} onClose={() => setNewOpts(null)} />}
    </Ctx.Provider>
  )
}

function CreateProfile({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const toast = useToast()
  const go = async () => { try { await api('profile.create', { name }); onDone() } catch (e) { setErr(errMsg(e)); toast('bad', errMsg(e)) } }
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="anim-fade-up w-full max-w-md">
        <div className="mb-8 flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-on-primary"><Briefcase size={18} aria-hidden /></div><span className="text-lg font-semibold tracking-tight">Career Hub</span></div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome. Let’s set up your private profile.</h1>
        <p className="mt-2 text-muted">Everything stays on this computer. No account, no cloud. You can add other profiles later for someone else who uses this device.</p>
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void go() }}>
          <Field label="Your name" error={err}>{(id) => <Input id={id} data-autofocus autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder="e.g. Nur Aisyah" autoComplete="name" />}</Field>
          <Button variant="primary" type="submit" disabled={!name.trim()} className="w-full">Continue</Button>
        </form>
      </div>
    </div>
  )
}

function Sidebar({ boot, page, onNav, onNew, onSwitch, onAdd }: { boot: Boot; page: Page; onNav: (p: Page) => void; onNew: () => void; onSwitch: (id: string) => void; onAdd: (name: string) => void }) {
  const [menu, setMenu] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [menu])
  const p = boot.profile
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <aside className="flex shrink-0 flex-col gap-3 border-b border-line bg-surface2/50 px-3 py-3 md:w-[236px] md:border-b-0 md:border-r md:px-3.5 md:py-5" aria-label="Primary">
        <div className="flex items-center justify-between gap-2 md:block">
          <div className="flex items-center gap-2.5 px-1 md:mb-5"><div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-on-primary"><Briefcase size={16} aria-hidden /></div><span className="font-semibold tracking-tight">Career Hub</span></div>
          <div ref={ref} className="relative md:mb-3">
            <button onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu} className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-sm hover:bg-surface2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{p.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span><ChevronsUpDown size={14} className="text-muted" aria-hidden />
            </button>
            {menu && (
              <div role="menu" className="anim-fade absolute left-0 right-0 top-full z-30 mt-1 min-w-[220px] rounded-lg border border-line bg-surface p-1 shadow-lg">
                {boot.profiles.map((x) => <button key={x.profile_id} role="menuitem" onClick={() => { setMenu(false); if (x.profile_id !== p.profile_id) onSwitch(x.profile_id) }} className={cx('flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface2', x.profile_id === p.profile_id && 'font-semibold')}>{x.name}{x.profile_id === p.profile_id && <span aria-label="current">✓</span>}</button>)}
                <div className="my-1 border-t border-line" />
                {adding ? (
                  <form className="flex gap-1 p-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name); setName(''); setAdding(false); setMenu(false) } }}>
                    <Input aria-label="New profile name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-8 py-1" /><Button size="sm" type="submit" variant="primary">Add</Button>
                  </form>
                ) : <button role="menuitem" onClick={() => setAdding(true)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-primary hover:bg-surface2"><Plus size={14} aria-hidden />Add another profile</button>}
              </div>
            )}
          </div>
        </div>
        <Button variant="primary" onClick={onNew} icon={<Plus size={16} aria-hidden />} className="w-full">New application</Button>
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Main">
          {NAV.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => onNav(key)} aria-current={page === key ? 'page' : undefined}
              className={cx('flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-150', page === key ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface2 hover:text-ink')}>
              <Icon size={17} aria-hidden />{label}
            </button>
          ))}
        </nav>
        <p className="mt-auto hidden px-1 text-xs leading-relaxed text-faint md:block">Private by default — your CV and applications are stored only on this device.</p>
      </aside>
    </>
  )
}
