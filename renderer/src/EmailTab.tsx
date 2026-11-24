import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Copy, FileText, FolderOpen, Mail, Paperclip, Save, Sparkles, XCircle } from 'lucide-react'
import { api, errMsg, fmtDateTime, fmtSize } from './api'
import { useApp } from './ctx'
import { Accordion, Banner, Button, Chip, Field, Input, Select, Textarea, cx, useToast } from './ui'

const KINDS = [['APPLY', 'Apply to vacancy'], ['SPECULATIVE', 'Speculative enquiry'], ['FOLLOW_UP', 'Follow-up'], ['THANK_YOU', 'Interview thank-you']] as const
type Kind = (typeof KINDS)[number][0]

export function EmailTab({ detail, reload, initialKind }: { detail: any; reload: () => void; initialKind?: Kind }) {
  const { boot } = useApp()
  const toast = useToast()
  const app = detail.app
  const [kind, setKind] = useState<Kind>(initialKind ?? (app.mode === 'SPECULATIVE_OUTREACH' ? 'SPECULATIVE' : 'APPLY'))
  const [lang, setLang] = useState<'en' | 'ms'>(boot.profile.prefs.language ?? 'en')
  const [to, setTo] = useState('')
  const [toNote, setToNote] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [atts, setAtts] = useState<any[]>([])
  const [lint, setLint] = useState<any[]>([])
  const [topic, setTopic] = useState('')
  const [when, setWhen] = useState('')
  const [saved, setSaved] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [ai, setAi] = useState<any>(null)
  useEffect(() => { api('ai.get').then(setAi).catch(() => {}) }, [])

  const compose = useCallback(async (keepTo = false) => {
    try {
      const r = await api('email.compose', { appId: app.application_id, kind, language: lang, to: keepTo ? to : undefined, interviewTopic: topic || undefined, interviewDate: when || undefined })
      setSubject(r.draft.subject); setBody(r.draft.body); setAtts(r.attachments); setToNote(r.toSource); if (!keepTo) setTo(r.to); setSaved(null)
    } catch (e) { toast('bad', errMsg(e)) }
  }, [app.application_id, kind, lang, to, topic, when, toast])
  const first = useRef(true)
  useEffect(() => { void compose(!first.current); first.current = false }, [kind, lang, detail.docs.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kind !== 'THANK_YOU') return; const t = setTimeout(() => void compose(true), 450); return () => clearTimeout(t) }, [topic, when]) // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = atts.filter((a) => a.checked)
  useEffect(() => {
    const t = setTimeout(() => { api('email.lint', { appId: app.application_id, to, subject, body, attachments: chosen.map((a) => ({ name: a.name, path: a.path })) }).then(setLint).catch(() => {}) }, 250)
    return () => clearTimeout(t)
  }, [to, subject, body, atts]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (key: string) => {
    const next = atts.map((a) => (a.key === key && a.exists ? { ...a, checked: !a.checked } : a))
    setAtts(next)
    setBody(await api('email.relabel', { body, labels: next.filter((a) => a.checked).map((a) => a.label), language: lang }))
  }
  const run = (k: string, fn: () => Promise<void>) => async () => { setBusy(k); try { await fn() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(null) } }
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast('ok', `${what} copied`), () => toast('bad', 'Copy was blocked by the system'))

  const saveEml = run('save', async () => {
    const r = await api('email.saveEml', { appId: app.application_id, kind, language: lang, to, subject, body, attachmentPaths: chosen.map((a) => a.path) })
    if (!r.ok) { setLint(r.lint); toast('bad', 'Fix the highlighted problems before saving the draft.'); return }
    setSaved(r); toast('ok', `Draft saved with ${chosen.length} attachment${chosen.length === 1 ? '' : 's'}. It has NOT been sent.`); reload()
  })
  const polish = run('ai', async () => { setBody(await api('email.polishAi', { appId: app.application_id, body, language: lang })); toast('ok', 'AI version applied — it passed the fact check. Review it before saving.') })
  const errors = lint.filter((l) => l.severity === 'error')
  const noDocs = !detail.docs.length

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap rounded-lg border border-line-strong bg-surface p-0.5" role="group" aria-label="Email type">{KINDS.map(([k, l]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={cx('rounded-md px-3 py-1 text-sm', kind === k ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:text-ink')}>{l}</button>)}</div>
          <Select aria-label="Email language" className="h-9 w-auto" value={lang} onChange={(e) => setLang(e.target.value as any)}><option value="en">English</option><option value="ms">Bahasa Malaysia</option></Select>
        </div>
        {kind === 'THANK_YOU' && <div className="grid gap-3 sm:grid-cols-2"><Field label="Topic you discussed (optional)" hint="Mention one real topic — leave blank to skip the sentence.">{(id) => <Input id={id} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. threat modelling for APIs" />}</Field><Field label="Interview date (optional)">{(id) => <Input id={id} value={when} onChange={(e) => setWhen(e.target.value)} placeholder="12 March" />}</Field></div>}
        {kind === 'FOLLOW_UP' && !app.applied_at && <Banner tone="info">You haven’t marked this application as applied yet. The follow-up wording will not mention a date.</Banner>}

        <Field label="To" hint={toNote} className="">{(id) => <Input id={id} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="No verified address — leave blank or enter one you confirmed" />}</Field>
        <Field label="Subject">{(id) => <Input id={id} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Message">{(id) => <Textarea id={id} rows={14} value={body} onChange={(e) => setBody(e.target.value)} className="font-[inherit]" />}</Field>
        <p className="tnum -mt-2 text-xs text-muted">{body.trim().split(/\s+/).filter(Boolean).length} words · a short email with the long letter attached reads best (about 100–180 words)</p>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium"><Paperclip size={14} aria-hidden />Attachments <span className="font-normal text-muted">— real files from this application’s folder</span></p>
          {noDocs && <Banner tone="warn">Generate documents first (CV Studio tab) so there are files to attach.</Banner>}
          <ul className="flex flex-wrap gap-2" aria-label="Attachments">
            {atts.map((a) => (
              <li key={a.key}><button type="button" role="checkbox" aria-checked={a.checked} disabled={!a.exists} onClick={() => toggle(a.key)} title={a.path}
                className={cx('flex max-w-[320px] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm disabled:opacity-60', a.checked ? 'border-primary bg-primary-soft' : 'border-line-strong bg-surface hover:bg-surface2', !a.exists && 'border-bad')}>
                <span aria-hidden className={cx('grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px]', a.checked ? 'border-primary bg-primary text-on-primary' : 'border-line-strong')}>{a.checked ? '✓' : ''}</span>
                <FileText size={15} className="shrink-0 text-muted" aria-hidden /><span className="min-w-0"><span className="block truncate font-medium">{a.name}</span><span className="block text-xs text-muted">{a.label} · {a.exists ? fmtSize(a.size) : <span className="text-bad">missing on disk</span>}</span></span></button></li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted">The resume you attached to this application is selected by default; a tailored CV is selected only once you approve it in CV Studio. A separate master CV or supporting letter is listed only if you uploaded one — choose it deliberately; transcripts contain personal data.</p>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <h3 className="mb-3 font-semibold">Use this email</h3>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => copy(subject, 'Subject')} icon={<Copy size={14} aria-hidden />}>Copy Subject</Button>
            <Button onClick={() => copy(body, 'Email')} icon={<Copy size={14} aria-hidden />}>Copy Email</Button>
            <Button variant="primary" busy={busy === 'save'} disabled={errors.length > 0} onClick={saveEml} icon={<Save size={14} aria-hidden />} className="col-span-2" data-testid="save-eml">Save Draft .eml</Button>
            <Button disabled={!saved} onClick={() => api('email.openEml', { path: saved.path }).catch((e) => toast('bad', errMsg(e)))} icon={<Mail size={14} aria-hidden />}>Open in Mail</Button>
            <Button onClick={() => api('fs.openAppFolder', { appId: app.application_id }).catch((e) => toast('bad', errMsg(e)))} icon={<FolderOpen size={14} aria-hidden />}>Open attachments folder</Button>
          </div>
          {saved && <div className="mt-3"><Banner tone="ok" title="Draft saved — not sent"><span className="break-all text-xs">{saved.path}</span><br /><span className="tnum text-xs">{fmtSize(saved.size)} · includes {chosen.length} attachment{chosen.length === 1 ? '' : 's'} · you must send it yourself</span></Banner></div>}
          {ai?.provider && (ai.consented || ai.local) && <Button className="mt-2 w-full" busy={busy === 'ai'} onClick={polish} icon={<Sparkles size={14} aria-hidden />}>Polish with AI</Button>}
          <div className="mt-3 border-t border-line pt-1">
            <Accordion title="If Open in Mail doesn’t work">
              <ol className="list-decimal space-y-1 pl-4 text-sm text-muted"><li>Click <strong>Copy Email</strong> and <strong>Copy Subject</strong>.</li><li>Open your email app (Gmail, Outlook, Apple Mail…) and start a new message.</li><li>Paste, then attach the files from <strong>Open attachments folder</strong>.</li></ol>
              <p className="mt-2 text-xs text-muted">A <code>mailto:</code> link cannot carry attachments, so Career Hub doesn’t pretend it can. The saved <code>.eml</code> file contains the real PDFs — double-click it to open as a draft in Outlook or Apple Mail. Gmail on the web can’t import .eml; use the manual steps above.</p>
            </Accordion>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4">
          <h3 className="mb-2 font-semibold">Checks</h3>
          {lint.length === 0 ? <p className="flex items-center gap-1.5 text-sm text-ok"><span aria-hidden>✓</span> No problems found.</p> : <ul className="space-y-1.5 text-sm">{lint.map((l, i) => <li key={i} className="flex items-start gap-2">{l.severity === 'error' ? <XCircle size={15} className="mt-0.5 shrink-0 text-bad" aria-label="Error" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-label="Warning" />}{l.message}</li>)}</ul>}
          <p className="mt-2 text-xs text-muted">Recipients are only what you enter or what seed research recorded — Career Hub never guesses an address.</p>
        </div>

        {detail.emails.length > 0 && (
          <div className="rounded-xl border border-line bg-surface p-4"><h3 className="mb-2 font-semibold">Saved drafts</h3>
            <ul className="divide-y divide-line text-sm">{detail.emails.map((e: any) => <li key={e.email_id} className="flex items-center gap-2 py-2"><div className="min-w-0 flex-1"><p className="truncate font-medium">{e.subject}</p><p className="text-xs text-muted">{fmtDateTime(e.created_at)} · {e.attachments.length} attachment{e.attachments.length === 1 ? '' : 's'}{e.fileState !== 'ok' && <span className="text-bad"> · file {e.fileState}</span>}</p></div>
              <Button size="sm" disabled={e.fileState === 'missing'} onClick={() => api('email.openEml', { path: e.eml_path }).catch((x) => toast('bad', errMsg(x)))}>Open</Button></li>)}</ul></div>
        )}
        {!to && <Chip tone="info">No recipient yet — that’s fine for a draft</Chip>}
      </div>
    </div>
  )
}
