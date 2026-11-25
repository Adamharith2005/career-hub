import { useCallback, useEffect, useState } from 'react'
import { Building2, FileText, Settings as SettingsIcon, UserRound } from 'lucide-react'
import { api, errMsg } from './api'
import { ToastHost, Spinner, cx, useToast } from './ui'
import { V, type Page, type ProfileSummary } from './viewer/vctx'
import { Picker } from './viewer/Picker'
import { Explorer } from './viewer/Explorer'
import { ProfilePage } from './viewer/ProfilePage'
import { DocManager } from './viewer/Docs'
import { MasterPanel } from './viewer/Masters'
import { SettingsPage } from './viewer/Settings'

/** Career Hub viewer: pick a profile, explore companies, copy what you need. No database, no tracking. */
const NAV: { key: Page; label: string; icon: typeof Building2 }[] = [
  { key: 'explore', label: 'Explore Companies', icon: Building2 },
  { key: 'profile', label: 'My Profile & CV', icon: UserRound },
  { key: 'resumes', label: 'My Resumes', icon: FileText },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
]
const store = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const save = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export function App() { return <ToastHost><Root /></ToastHost> }

function Root() {
  const toast = useToast()
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [page, setPage] = useState<Page>('explore')
  const [selected, setSelected] = useState<string | null>(null)
  const [docsKey, setDocsKey] = useState(0)
  const [theme, setTheme] = useState(store('ch.theme', 'system'))
  const [motion, setMotion] = useState(store('ch.motion', 'normal'))
  useEffect(() => { const r = document.documentElement; if (theme === 'system') r.removeAttribute('data-theme'); else r.dataset.theme = theme; save('ch.theme', theme) }, [theme])
  useEffect(() => { const r = document.documentElement; if (motion === 'reduced') r.dataset.motion = 'reduced'; else r.removeAttribute('data-motion'); save('ch.motion', motion) }, [motion])
  useEffect(() => { const r = document.documentElement; if (profileId) r.dataset.profile = profileId; else r.removeAttribute('data-profile') }, [profileId])
  useEffect(() => { api('v.profiles').then(setProfiles).catch((e) => toast('bad', errMsg(e))) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const loadProfile = useCallback(async (id: string) => { const p = await api('v.profile.get', { id }); setProfile((cur: any) => (p.id === id ? p : cur)) }, [])
  useEffect(() => { if (!profileId) return; let live = true; api('v.profile.get', { id: profileId }).then((p) => { if (live) setProfile(p) }).catch((e) => toast('bad', errMsg(e))); return () => { live = false } }, [profileId])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!profiles) return <Spinner label="Opening Career Hub" />
  if (!profileId) return <Picker profiles={profiles} onPick={(id) => { setProfile(null); setProfileId(id); setPage('explore'); setSelected(null) }} />
  if (!profile || profile.id !== profileId) return <Spinner label="Loading profile" />

  const ctx = {
    profiles, profile, profileId, page, selected,
    switchProfile: (id: string) => { setProfile(null); setProfileId(id); setSelected(null) },
    leave: () => { setProfileId(null); setProfile(null); setSelected(null) },
    go: setPage, select: setSelected, reloadProfile: () => loadProfile(profileId),
  }
  const me = profiles.find((p) => p.id === profileId)!
  return (
    <V.Provider value={ctx}>
      <div className="flex h-full min-h-0">
        <aside className="flex w-[216px] shrink-0 flex-col border-r border-line px-5 py-6 max-[1180px]:w-[72px] max-[1180px]:items-center max-[1180px]:px-2" aria-label="Sidebar">
          <p className="font-display text-[1.65rem] leading-none tracking-[-0.01em] max-[1180px]:hidden">Career Hub</p>
          <p aria-hidden className="font-display hidden text-[1.5rem] leading-none max-[1180px]:block">CH</p>
          <button onClick={ctx.leave} data-testid="profile-chip" aria-label={`Active profile ${me.displayName}. Switch profile`} title="Switch profile" className="press mt-7 w-full border-y border-line py-3 text-left hover:border-primary max-[1180px]:text-center">
            <span key={me.id} className="anim-detail block">
              <span className="block truncate text-[15px] font-semibold leading-tight max-[1180px]:sr-only" data-testid="active-profile">{me.displayName}</span>
              <span aria-hidden className="font-display hidden text-[1.6rem] leading-none max-[1180px]:block">{me.initials}</span>
              <span className="block truncate text-[12.5px] text-muted max-[1180px]:sr-only">{me.specialisation}</span>
              <span className="mt-1 block text-[12.5px] text-primary max-[1180px]:hidden">Switch profile</span>
            </span>
          </button>
          <nav className="mt-6 flex flex-col" aria-label="Primary">
            {NAV.map((n) => { const on = page === n.key; return (
              <button key={n.key} onClick={() => setPage(n.key)} aria-current={on ? 'page' : undefined} title={n.label} className={cx('ledger-sel press flex items-center gap-3 py-2 pl-3 text-left text-[14px] transition-colors duration-150 max-[1180px]:justify-center max-[1180px]:pl-2', on ? 'is-on font-medium text-ink' : 'text-muted hover:text-ink')}>
                <n.icon size={16} strokeWidth={1.6} aria-hidden className="shrink-0" /><span className="max-[1180px]:sr-only">{n.label}</span></button>) })}
          </nav>
          <p className="mt-auto text-[12px] leading-snug text-faint max-[1180px]:hidden">Private and offline. Nothing is sent anywhere, and nothing is tracked.</p>
        </aside>
        <main key={profileId} className="anim-fade-up min-h-0 min-w-0 flex-1" aria-label={NAV.find((n) => n.key === page)!.label}>
          {page === 'explore' ? <Explorer />
            : page === 'profile' ? <ProfilePage />
            : page === 'resumes' ? <div className="scroll-thin h-full overflow-y-auto px-8 py-6"><header className="mb-6"><h1 className="page-title">My Resumes</h1><p className="mt-2 max-w-xl text-[14px] text-muted">Files you wrote yourself, kept exactly as given, with every version. Career Hub never rewrites them.</p></header><MasterPanel onChanged={() => setDocsKey((k) => k + 1)} /><DocManager key={docsKey} kind="RESUME" /></div>
            : <SettingsPage theme={theme} setTheme={setTheme} motion={motion} setMotion={setMotion} />}
        </main>
      </div>
    </V.Provider>
  )
}
