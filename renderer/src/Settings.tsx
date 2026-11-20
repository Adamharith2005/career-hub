import { useEffect, useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'
import { api, errMsg } from './api'
import { useApp } from './ctx'
import { Banner, Button, Chip, Field, Input, Modal, Select, Toggle, useAsync, useToast } from './ui'

export interface AiForm { provider: '' | 'anthropic' | 'openai-compatible'; model: string; baseUrl: string; apiKey: string; redact: boolean; consent: boolean }
const PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { label: 'Ollama (this computer)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
]
const hostOf = (f: AiForm) => { try { return new URL(f.baseUrl || (f.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')).host } catch { return 'the provider' } }

export function AiFields({ value: v, onChange, secureStorage, hasKey, compact }: { value: AiForm; onChange: (v: AiForm) => void; secureStorage: boolean; hasKey?: boolean; compact?: boolean }) {
  const set = (p: Partial<AiForm>) => onChange({ ...v, ...p })
  const host = hostOf(v)
  const local = /^(localhost|127\.)/.test(host)
  return (
    <div className="space-y-3">
      <Field label="Provider">
        {(id) => <Select id={id} value={v.provider} onChange={(e) => set({ provider: e.target.value as AiForm['provider'], model: '', baseUrl: '', consent: false })}>
          <option value="">None — work without AI</option><option value="anthropic">Anthropic (Claude)</option><option value="openai-compatible">OpenAI-compatible endpoint / local model</option>
        </Select>}
      </Field>
      {v.provider && (
        <>
          {v.provider === 'openai-compatible' && <div className="flex flex-wrap gap-1.5" aria-label="Presets">{PRESETS.map((p) => <Button key={p.label} size="sm" onClick={() => set({ baseUrl: p.baseUrl, model: p.model, consent: false })}>{p.label}</Button>)}</div>}
          <div className={compact ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3 md:grid-cols-2'}>
            <Field label="Model" hint={v.provider === 'anthropic' ? 'Default: claude-sonnet-5-5' : undefined}>{(id) => <Input id={id} value={v.model} onChange={(e) => set({ model: e.target.value })} placeholder={v.provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-4.1-mini'} />}</Field>
            {v.provider === 'openai-compatible' && <Field label="Endpoint (https)" hint="http:// is allowed only for localhost">{(id) => <Input id={id} value={v.baseUrl} onChange={(e) => set({ baseUrl: e.target.value, consent: false })} placeholder="https://api.openai.com/v1" />}</Field>}
          </div>
          {!local && (
            <Field label="API key" hint={secureStorage ? 'Encrypted with your operating-system credential store. Never saved as plain text.' : 'Secure key storage is NOT available on this computer, so keys cannot be saved. Use a local model instead.'}>
              {(id) => <Input id={id} type="password" autoComplete="off" disabled={!secureStorage} value={v.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder={hasKey ? '••••••••  saved — type to replace' : 'Paste your API key'} />}
            </Field>
          )}
          <div className="rounded-lg bg-surface2 p-3 text-sm">
            <p className="font-medium">What is sent</p>
            <p className="mt-0.5 text-muted">{local ? 'Everything stays on this computer.' : <>When you use an AI feature, the job text and the confirmed facts needed for that task are sent to <strong className="text-ink">{host}</strong>. Your name, email, phone and links are never sent. Your provider’s own policy then applies.</>}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Toggle on={v.redact} onClick={() => set({ redact: !v.redact })}>Also mask emails, phones and links in text</Toggle>
              <Toggle on={v.consent || local} disabled={local} onClick={() => set({ consent: !v.consent })}>I agree to send this data to {host}</Toggle>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function SettingsPage() {
  const { boot, refresh, tick } = useApp()
  const toast = useToast()
  const p = boot.profile
  const ai = useAsync(() => api('ai.get'), [tick])
  const [form, setForm] = useState<AiForm | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [days, setDays] = useState(boot.followupDays)
  const [confirmDel, setConfirmDel] = useState<any>(null)
  const [backup, setBackup] = useState<any>(null)
  useEffect(() => { if (ai.data) setForm({ provider: ai.data.provider, model: ai.data.model, baseUrl: ai.data.baseUrl, apiKey: '', redact: ai.data.redact, consent: ai.data.consented }) }, [ai.data])
  const wrap = (k: string, fn: () => Promise<void>) => async () => { setBusy(k); try { await fn() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(null) } }

  const saveAi = wrap('ai', async () => { await api('ai.set', { ...form, apiKey: form!.apiKey || undefined }); ai.reload(); await refresh(); toast('ok', form!.provider ? 'AI settings saved' : 'AI turned off') })
  const testAi = wrap('test', async () => { await api('ai.test'); toast('ok', 'The provider responded correctly.') })
  const changeFolder = wrap('folder', async () => { const c = await api('folder.choose'); if (!c) return; await api('folder.set', { path: c }); await refresh(); toast('ok', 'Folder updated. Existing files stay where they are.') })
  const savePrefs = (patch: any) => wrap('prefs', async () => { await api('profile.update', { prefs: patch }); await refresh() })()

  return (
    <div className="max-w-3xl">
      <header className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">Settings</h1><p className="mt-1 text-muted">Defaults work out of the box. Change only what you need.</p></header>
      <div className="space-y-5">
        <Card title="Storage">
          <p className="break-all text-sm"><span className="text-muted">Career Hub folder: </span><span data-testid="settings-root">{p.storage_root ?? 'Not chosen yet'}</span></p>
          <div className="mt-3 flex flex-wrap gap-2"><Button busy={busy === 'folder'} onClick={changeFolder} icon={<FolderOpen size={15} aria-hidden />}>{p.storage_root ? 'Change folder' : 'Choose folder'}</Button>{p.storage_root && <Button onClick={() => api('fs.openRoot').catch((e) => toast('bad', errMsg(e)))}>Open in file explorer</Button>}</div>
        </Card>

        <Card title="AI assistant" right={ai.data?.provider ? <Chip tone={ai.data.consented || ai.data.local ? 'ok' : 'warn'}>{ai.data.consented || ai.data.local ? 'Ready' : 'Needs your consent'}</Chip> : <Chip>Off</Chip>}>
          {form ? <AiFields value={form} onChange={setForm} secureStorage={boot.secureKeyStorage} hasKey={ai.data?.hasKey} /> : null}
          <div className="mt-4 flex flex-wrap gap-2"><Button variant="primary" busy={busy === 'ai'} onClick={saveAi}>Save AI settings</Button>{ai.data?.provider && <Button busy={busy === 'test'} onClick={testAi}>Test connection</Button>}</div>
          <p className="mt-3 text-xs text-muted">Claude Code or a Claude subscription does not provide an API key for this app. If you don’t add one, AI features simply stay off and everything else keeps working.</p>
        </Card>

        <Card title="Appearance & language">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Theme">{(id) => <Select id={id} value={p.prefs.theme ?? 'system'} onChange={(e) => savePrefs({ theme: e.target.value })}><option value="system">Match my system</option><option value="light">Light</option><option value="dark">Dark</option></Select>}</Field>
            <Field label="Default language for documents">{(id) => <Select id={id} value={p.prefs.language ?? 'en'} onChange={(e) => savePrefs({ language: e.target.value })}><option value="en">English</option><option value="ms">Bahasa Malaysia</option></Select>}</Field>
          </div>
        </Card>

        <Card title="Follow-up reminders">
          <Field label="Suggest a follow-up after (business days)" hint="Applies when you mark an application as applied. In-app reminders only — nothing is sent.">{(id) => <Input id={id} type="number" min={1} max={30} className="max-w-[120px]" value={days} onChange={(e) => setDays(Number(e.target.value))} onBlur={wrap('days', async () => { await api('settings.set', { followupDays: days }); await refresh() })} />}</Field>
        </Card>

        <Card title="Backup">
          <p className="text-sm text-muted">Creates a snapshot of your database (profiles, facts, applications, history). Your document files already live in your Career Hub folder.</p>
          <Button className="mt-3" busy={busy === 'backup'} onClick={wrap('backup', async () => setBackup(await api('backup.create')))}>Create backup now</Button>
          {backup && <div className="mt-3"><Banner tone="ok" title="Backup created"><span className="break-all">{backup.path}</span><br />{backup.note}</Banner></div>}
        </Card>

        <Card title="Profiles on this computer">
          <ul className="divide-y divide-line text-sm">{boot.profiles.map((x) => (
            <li key={x.profile_id} className="flex items-center gap-2 py-2"><span className="flex-1 font-medium">{x.name}{x.profile_id === p.profile_id && <Chip tone="info" className="ml-2">Current</Chip>}</span>
              <Button size="sm" variant="ghost" aria-label={`Delete profile ${x.name}`} onClick={() => setConfirmDel(x)}><Trash2 size={15} aria-hidden /></Button></li>))}</ul>
          <p className="mt-2 text-xs text-muted">Profiles keep each person’s facts, applications, settings and folders separate. This is a convenience boundary on a shared computer, not a replacement for your operating-system account or disk encryption.</p>
        </Card>

        <details className="rounded-xl border border-line bg-surface p-5"><summary className="font-semibold">Advanced</summary>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[160px_1fr]"><dt className="text-muted">App data folder</dt><dd className="break-all">{boot.dataDir}</dd><dt className="text-muted">Companies in directory</dt><dd>{boot.companyCount}</dd><dt className="text-muted">Secure key storage</dt><dd>{boot.secureKeyStorage ? 'Available' : 'Not available'}</dd></dl>
        </details>
      </div>
      {confirmDel && (
        <Modal title={`Delete “${confirmDel.name}”?`} onClose={() => setConfirmDel(null)} footer={<><Button onClick={() => setConfirmDel(null)}>Cancel</Button><Button variant="danger" onClick={async () => { try { await api('profile.delete', { id: confirmDel.profile_id }); setConfirmDel(null); await refresh() } catch (e) { toast('bad', errMsg(e)) } }}>Delete profile data</Button></>}>
          <p className="text-sm">This removes the profile’s facts, applications and history from the app. Files already saved in the Career Hub folder are <strong>not</strong> deleted.</p>
        </Modal>
      )}
    </div>
  )
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-xl border border-line bg-surface p-5"><div className="mb-3 flex items-center gap-2"><h2 className="flex-1 font-semibold">{title}</h2>{right}</div>{children}</section>
}
