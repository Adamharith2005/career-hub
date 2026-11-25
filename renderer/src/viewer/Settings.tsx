import { useEffect, useState } from 'react'
import { FolderOpen, Upload } from 'lucide-react'
import { api, errMsg } from '../api'
import { Banner, Button, Select, useToast } from '../ui'
import { useV } from './vctx'

export function SettingsPage({ theme, setTheme, motion, setMotion }: { theme: string; setTheme: (t: string) => void; motion: string; setMotion: (m: string) => void }) {
  const { profiles, profileId, switchProfile, leave } = useV()
  const toast = useToast()
  const [about, setAbout] = useState<any>(null)
  const [pv, setPv] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<any>(null)
  const load = () => api('v.about').then(setAbout).catch(() => {})
  useEffect(() => { void load() }, [])
  const pick = async () => { setBusy(true); setDone(null); try { const r = await api('v.catalog.preview', {}); if (r) setPv(r) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const onDrop = async (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; try { setPv(await api('v.catalog.preview', { path: window.careerHub.pathForFile(f) })) } catch (x) { toast('bad', errMsg(x)) } }
  const apply = async () => { setBusy(true); try { const r = await api('v.catalog.apply', { path: pv.path }); setDone(r); setPv(null); toast('ok', `Company list updated: ${r.added} added, ${r.updated} changed.`); await load() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return (
    <div className="scroll-thin h-full overflow-y-auto px-8 py-6">
      <header><h1 className="page-title">Settings</h1></header>
      <div className="mt-6 grid max-w-2xl">
        <section className="border-t border-line py-5" aria-label="Appearance">
          <h2 className="text-[15px] font-semibold">Appearance</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Theme<Select aria-label="Theme" className="mt-1" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="system">Match this computer</option><option value="light">Light</option><option value="dark">Dark</option></Select></label>
            <label className="text-sm font-medium">Motion<Select aria-label="Motion" className="mt-1" value={motion} onChange={(e) => setMotion(e.target.value)}><option value="normal">Standard</option><option value="reduced">Reduced</option></Select></label>
          </div>
        </section>
        <section className="border-t border-line py-5" aria-label="Profile">
          <h2 className="text-[15px] font-semibold">Profile</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">{profiles.map((p) => <Button key={p.id} variant={p.id === profileId ? 'primary' : 'secondary'} onClick={() => switchProfile(p.id)} aria-pressed={p.id === profileId}>{p.displayName}</Button>)}<Button variant="ghost" onClick={leave}>Back to profile selection</Button></div>
          <p className="mt-2 text-xs text-muted">Profiles are separate. Switching never mixes contact details, documents or drafts.</p>
        </section>
        <section className="border-t border-line py-5" aria-label="Local files">
          <h2 className="text-[15px] font-semibold">Local files</h2>
          <p className="mt-1 text-sm text-muted">Everything is stored on this computer. No account, no cloud, no database to connect.</p>
          {about && <dl className="mt-3 space-y-1 text-sm"><div className="flex gap-2"><dt className="w-32 text-muted">Data folder</dt><dd className="min-w-0 break-all font-mono text-[12.5px]" data-testid="data-dir">{about.dataDir}</dd></div><div className="flex gap-2"><dt className="w-32 text-muted">Company list</dt><dd>{about.companies} organisations · {about.catalogSource || 'bundled'}</dd></div></dl>}
          <div className="mt-3"><Button size="sm" onClick={() => api('v.openDataFolder').catch((e) => toast('bad', errMsg(e)))} icon={<FolderOpen size={14} aria-hidden />}>Show data folder</Button></div>
          <p className="mt-3 text-xs text-muted">To move to another computer, copy this folder’s <code>viewer</code> directory into the same place on the new one.</p>
        </section>
        <section className="border-t border-line py-5" aria-label="Update company list" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <h2 className="text-[15px] font-semibold">Update company list</h2>
          <p className="mt-1 text-sm text-muted">Choose a newer research workbook (.xlsx). It is merged safely: blanks never erase verified details, stronger evidence is kept, and no organisation is removed.</p>
          <div className="mt-3"><Button busy={busy} onClick={pick} icon={<Upload size={15} aria-hidden />} data-testid="catalog-pick">Choose a workbook</Button></div>
          {pv && <div className="anim-fade-up mt-4 rounded-lg border border-line p-3.5 text-sm" data-testid="catalog-preview">
            <p className="font-medium">{pv.filename}</p>
            <p className="mt-1 text-muted">{pv.rows} organisations found → {pv.report.added} new, {pv.report.updated} changed, {pv.report.unchanged} unchanged</p>
            {pv.report.keptExisting.length > 0 && <p className="mt-1 text-xs text-muted">{pv.report.keptExisting.length} stronger existing record(s) kept.</p>}
            <div className="mt-3 flex gap-2"><Button variant="primary" size="sm" busy={busy} onClick={apply} data-testid="catalog-apply">Update company list</Button><Button size="sm" variant="ghost" onClick={() => setPv(null)}>Cancel</Button></div></div>}
          {done && <div className="mt-3"><Banner tone="ok" title="Company list updated">{done.total} organisations in total. The previous list was backed up beside it.</Banner></div>}
        </section>
      </div>
    </div>
  )
}
