import { useEffect, useState } from 'react'
import { ExternalLink, FileText, FolderOpen, Mail, RotateCcw, RefreshCw, TriangleAlert } from 'lucide-react'
import { VERIFICATION_LABEL } from './labels'
import { api, errMsg } from '../api'
import { Banner, Button, Spinner, cx } from '../ui'
import { CopyButton, CopyIcon } from './Copy'
import { useV } from './vctx'

/** Offline template draft in the Career Hub email standard. Copy-only: nothing is ever sent from here. */
export function EmailDraft({ company, role, recipientKey, onRecipient }: { company: any; role: string | null; recipientKey: string | null; onRecipient: (k: string | null) => void }) {
  const { profileId, profile, reloadProfile } = useV()
  const [att, setAtt] = useState<{ options: any[]; defaults: string[] } | null>(null)
  const [keys, setKeys] = useState<string[] | null>(null)
  const [withAvail, setWithAvail] = useState(true)
  const [d, setD] = useState<any>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)
  const [handoff, setHandoff] = useState(false)
  const [ticked, setTicked] = useState<string[]>([])
  const a = profile.availability
  useEffect(() => { let live = true; api('v.email.attachments', { profileId, companyId: company.id }).then((x) => { if (live) { setAtt(x); setKeys(x.defaults) } }).catch((e) => live && setErr(errMsg(e))); return () => { live = false } }, [profileId, company.id])
  useEffect(() => {
    if (keys == null) return
    let live = true; setErr('')
    api('v.email.draft', { profileId, companyId: company.id, role: role ?? undefined, attachmentKeys: keys, includeAvailability: withAvail, recipientKey }).then((x) => { if (live) { setD(x); setSubject(x.subject); setBody(x.body) } }).catch((e) => live && setErr(errMsg(e)))
    return () => { live = false }
  }, [profileId, company.id, role, keys, withAvail, tick, recipientKey])
  if (err) return <Banner tone="bad" title="Could not prepare a draft">{err}</Banner>
  if (!d || !att) return <Spinner label="Preparing draft" />
  const apply = company.internship.applicationUrl
  const toggle = (k: string) => setKeys((cur) => ((cur ?? []).includes(k) ? (cur ?? []).filter((x) => x !== k) : [...(cur ?? []), k]))
  const chosen = att.options.filter((o: any) => o.available && keys?.includes(o.key))
  const showFile = (o: any) => (o.key.startsWith('cv:') ? api('v.cv.export', { id: profileId, recId: o.recId, versionId: o.cvVersionId }) : api('v.docs.exportCopy', { id: profileId, versionId: o.docVersionId })).catch((e) => console.error(errMsg(e)))
  const full = `${d.to ? `To: ${d.to}\n` : ''}Subject: ${subject}\n\n${body}`
  return (
    <div data-testid="email-draft">
      <p className="mb-3 text-[13px] text-muted">For {profile.displayName} · {d.roleTitle} · {d.speculative ? 'an enquiry, not an advertised opening' : 'application'} · <span className="figure text-[12px]" data-testid="draft-words">{d.words}</span> words</p>
      <div className="rounded-md border border-line-strong bg-surface">
        <div className="has-reveal flex items-baseline gap-3 border-b border-line px-4 py-2.5">
          <span className="w-14 shrink-0 text-[13px] text-muted">To</span>
          {d.to ? <><span className="min-w-0 flex-1 truncate font-mono text-[13px]" data-testid="draft-to">{d.to}</span><span className="reveal-copy"><CopyIcon text={d.to} label="recipient" /></span></> : <span className="text-[13px] text-faint" data-testid="draft-to-empty">No recipient filled in</span>}
        </div>
        <p className="border-b border-line py-1.5 pl-[5.75rem] pr-4 text-xs text-muted" data-testid="draft-to-note">{d.toNote}</p>
        {d.toWarning && <p className="flex gap-1.5 border-b border-line bg-warn-bg py-1.5 pl-[5.75rem] pr-4 text-xs text-warn" role="note" data-testid="draft-to-warning"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{d.toWarning}</p>}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-1.5">
          <label htmlFor="draft-recipient" className="w-14 shrink-0 text-[12px] text-muted">Contact</label>
          <select id="draft-recipient" data-testid="recipient-select" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[13px]" value={d.toKey ?? ''} onChange={(e) => onRecipient(e.target.value || null)}>
            <option value="">{d.recipients.length ? 'Automatic: verified contact only' : 'No researched email addresses'}</option>
            {d.recipients.map((r: any) => <option key={r.key} value={r.key}>{r.email} · {VERIFICATION_LABEL[r.verification]}</option>)}
          </select>
          {recipientKey && <Button size="sm" variant="ghost" onClick={() => onRecipient(null)}>Use automatic choice</Button>}
        </div>
        {!d.to && d.portal && <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-[13px]" data-testid="draft-portal"><span>This organisation takes applications through a careers portal{d.portal.verified ? '' : ' (reported, not inspected)'}. No email address is filled in.</span><Button size="sm" variant="secondary" onClick={() => api('v.openExternal', { url: d.portal.url })} icon={<ExternalLink size={14} aria-hidden />}>Open Careers Portal</Button></div>}
        <div className="has-reveal flex items-center gap-3 border-b border-line px-4 py-1.5">
          <label htmlFor="draft-subject" className="w-14 shrink-0 text-[13px] text-muted">Subject</label>
          <input id="draft-subject" className="h-8 min-w-0 flex-1 bg-transparent text-sm focus-visible:outline-offset-0" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <span className="reveal-copy"><CopyIcon text={subject} label="subject" /></span>
        </div>
        <textarea aria-label="Email body" rows={15} className="prose-read block w-full resize-y bg-transparent px-4 py-4 focus-visible:outline-offset-[-2px]" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>

      <fieldset className="mt-4" data-testid="attachments"><legend className="mb-1.5 text-[13px] font-bold">Documents to attach yourself</legend>
        <ul className="space-y-1">
          {att.options.map((o) => (
            <li key={o.key}><label className={cx('flex items-start gap-2 text-[13px]', !o.available && 'text-faint')}>
              <input type="checkbox" className="mt-0.5 accent-[var(--primary)]" disabled={!o.available} checked={o.available && !!keys?.includes(o.key)} onChange={() => toggle(o.key)} />
              <span><FileText size={13} className="mr-1 inline" aria-hidden />{o.label}{!o.available && <span className="ml-1.5 text-[12px]">· {o.reason}</span>}</span></label></li>))}
        </ul>
        <p className="mt-1.5 text-xs text-muted">The email only mentions documents ticked here. Career Hub cannot attach files for you. Attach them in your email program.</p>
      </fieldset>

      {a?.confirmed ? <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-[var(--primary)]" checked={withAvail} onChange={(e) => setWithAvail(e.target.checked)} data-testid="avail-toggle" />Include {profile.displayName}’s confirmed availability{a.programme ? ` (${a.programme}, ${a.start ?? ''}${a.end ? ` to ${a.end}` : ''})` : ''} in this email</label>
        : <p className="mt-3 text-xs text-muted">No confirmed availability is recorded for {profile.displayName}, so no dates or programme appear in the draft. <AvailabilityEditor onSaved={() => reloadProfile()} /></p>}

      <div className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-1.5">
        <CopyButton variant="primary" size="sm" text={full} what="the whole email" testId="copy-draft">Copy entire email</CopyButton>
        <CopyButton variant="ghost" size="sm" text={body} what="email body" testId="copy-body">Copy body</CopyButton>
        <CopyButton variant="ghost" size="sm" text={subject} what="subject" testId="copy-subject">Copy subject</CopyButton>
        {d.to && <CopyButton variant="ghost" size="sm" text={d.to} what="recipient" testId="copy-recipient">Copy recipient</CopyButton>}
        {d.to && <Button size="sm" variant="ghost" onClick={async () => { await api('v.email.mailto', { to: d.to, subject, body }); setTicked([]); setHandoff(true) }} icon={<Mail size={14} aria-hidden />} data-testid="open-mail">Open in email app</Button>}
        {apply && <Button size="sm" variant="ghost" onClick={() => api('v.openExternal', { url: apply })} icon={<ExternalLink size={14} aria-hidden />}>Open application page</Button>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setTick((t) => t + 1)} icon={<RefreshCw size={14} aria-hidden />} data-testid="regen">Regenerate draft</Button>
        <Button size="sm" variant="ghost" onClick={() => { setSubject(d.subject); setBody(d.body) }} icon={<RotateCcw size={14} aria-hidden />} data-testid="restore">Restore suggested template</Button>
      </div>
      <div className="mt-3 flex gap-2 rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-[12.5px] text-warn" role="note" data-testid="attach-warning"><TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
        <span><b>Files are not attached automatically.</b> “Open in email app” fills in the recipient, subject and text only.{chosen.length ? ` Attach the ${chosen.length} selected document${chosen.length > 1 ? 's' : ''} yourself before you send.` : ' No documents are selected, so the email does not mention any attachments.'}</span></div>
      {handoff && chosen.length > 0 && (
        <div className="anim-fade-up mt-3 rounded-md border border-line-strong bg-surface p-3" data-testid="attach-checklist" aria-label="Before you send">
          <p className="text-[13px] font-bold">Before you send: attach these in your email app</p>
          <ul className="mt-2 space-y-1.5">{chosen.map((o: any) => (
            <li key={o.key} className="flex items-center gap-2 text-[13px]"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" className="accent-[var(--primary)]" checked={ticked.includes(o.key)} onChange={() => setTicked((t) => (t.includes(o.key) ? t.filter((x) => x !== o.key) : [...t, o.key]))} /><span className={cx('min-w-0 truncate', ticked.includes(o.key) && 'text-muted line-through')}>{o.label}</span></label>
              <Button size="sm" variant="ghost" onClick={() => showFile(o)} icon={<FolderOpen size={14} aria-hidden />}>Show file</Button></li>))}</ul>
          <p className="mt-2 text-xs text-muted" data-testid="attach-status">{ticked.length === chosen.length ? 'All documents ticked. You have attached everything the email mentions.' : `${chosen.length - ticked.length} of ${chosen.length} still to attach. The email says they are attached, so do not send it until they are.`}</p>
        </div>)}
    </div>
  )
}

/** Small inline editor for availability. Nothing appears in an email until it is marked confirmed. */
function AvailabilityEditor({ onSaved }: { onSaved: () => void }) {
  const { profileId } = useV()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ studyYear: '', programme: '', duration: '', start: '', end: '' })
  if (!open) return <button className="text-primary underline" onClick={() => setOpen(true)}>Add availability</button>
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <span className="mt-2 block rounded-md border border-line p-3">
      <span className="grid gap-2 sm:grid-cols-2">
        {([['studyYear', 'Year of study (for example second-year)'], ['programme', 'Programme name, if any'], ['duration', 'Duration (for example 6-month)'], ['start', 'Start (for example July 2027)'], ['end', 'End']] as const).map(([k, l]) => <label key={k} className="text-[12px]">{l}<input value={f[k]} onChange={set(k)} className="mt-0.5 h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px]" /></label>)}
      </span>
      <Button size="sm" variant="primary" className="mt-2" onClick={async () => { await api('v.profile.patch', { id: profileId, patch: { availability: { ...f, confirmed: true, source: 'Entered by the student' } } }); onSaved() }}>Save as confirmed</Button>
    </span>
  )
}
