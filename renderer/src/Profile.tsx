import { useEffect, useMemo, useState } from 'react'
import { Check, Circle, FileText, Paperclip, Star, Trash2, Upload } from 'lucide-react'
import { api, CATEGORY_LABEL, errMsg, fmtDate } from './api'
import { useApp } from './ctx'
import { SavedIndicator, useAutosave } from './kit'
import { EntryList, SkillsEditor, useFactList } from './ProfileEditors'
import { Banner, Button, Chip, Field, Input, Select, Toggle, cx, useToast } from './ui'

// ---------------------------------------------------------------- role picker (shared with onboarding)
export function RolePicker({ roleFamilies, roles, primary, other, onChange }: {
  roleFamilies: { key: string; label: string }[]; roles: string[]; primary: string | null; other: string
  onChange: (v: { roles: string[]; primary: string | null; other: string }) => void
}) {
  const toggle = (k: string) => {
    const next = roles.includes(k) ? roles.filter((r) => r !== k) : [...roles, k]
    onChange({ roles: next, primary: next.includes(primary ?? '') ? primary : next[0] ?? null, other })
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Target roles">
        {roleFamilies.map((r) => <Toggle key={r.key} on={roles.includes(r.key)} onClick={() => toggle(r.key)}>{r.label}</Toggle>)}
      </div>
      {roles.includes('other') && <Input className="mt-3 max-w-sm" aria-label="Describe the other role" placeholder="Describe the role, e.g. Embedded systems intern" value={other} onChange={(e) => onChange({ roles, primary, other: e.target.value })} />}
      {roles.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Main focus:</span>
          {roles.map((k) => (
            <button key={k} onClick={() => onChange({ roles, primary: k, other })} aria-pressed={primary === k} className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs', primary === k ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface hover:bg-surface2')}>
              {primary === k && <Star size={11} aria-hidden />}{roleFamilies.find((r) => r.key === k)?.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PrefsFields({ prefs, onChange }: { prefs: any; onChange: (p: any) => void }) {
  const set = (k: string, v: any) => onChange({ ...prefs, [k]: v })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Internship starts" hint="e.g. March 2027">{(id) => <Input id={id} value={prefs.internshipStart ?? ''} onChange={(e) => set('internshipStart', e.target.value)} placeholder="March 2027" />}</Field>
      <Field label="Internship ends">{(id) => <Input id={id} value={prefs.internshipEnd ?? ''} onChange={(e) => set('internshipEnd', e.target.value)} placeholder="August 2027" />}</Field>
      <Field label="Duration available (weeks)">{(id) => <Input id={id} type="number" min={4} max={60} value={prefs.durationWeeks ?? ''} onChange={(e) => set('durationWeeks', e.target.value ? Number(e.target.value) : undefined)} placeholder="24" />}</Field>
      <Field label="Work arrangement">{(id) => <Select id={id} value={prefs.workMode ?? ''} onChange={(e) => set('workMode', e.target.value)}><option value="">No preference</option><option value="onsite">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></Select>}</Field>
      <Field label="Citizenship" hint="Lets us check citizenship requirements. Optional.">{(id) => <Select id={id} value={prefs.citizenship ?? ''} onChange={(e) => set('citizenship', e.target.value)}><option value="">Prefer not to say</option><option value="malaysian">Malaysian</option><option value="other">Other</option></Select>}</Field>
      <Field label="Language for documents">{(id) => <Select id={id} value={prefs.language ?? 'en'} onChange={(e) => set('language', e.target.value)}><option value="en">English</option><option value="ms">Bahasa Malaysia</option></Select>}</Field>
    </div>
  )
}

const SECTIONS = [
  { id: 'basics', label: 'Basics' }, { id: 'education', label: 'Education' }, { id: 'roles', label: 'Target roles' }, { id: 'skills', label: 'Skills' },
  { id: 'projects', label: 'Projects' }, { id: 'experience', label: 'Experience' }, { id: 'achievements', label: 'Achievements' }, { id: 'links', label: 'Links' }, { id: 'availability', label: 'Availability' },
] as const
const jump = (id: string) => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

function Section({ id, title, hint, children, right }: { id: string; title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section id={`sec-${id}`} aria-labelledby={`h-${id}`} className="card scroll-mt-4 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3"><div className="min-w-0 flex-1"><h2 id={`h-${id}`} className="font-display text-xl font-semibold">{title}</h2>{hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}</div>{right}</div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- optional import (a shortcut, never a requirement) — results are reviewed before use
function ImportReview({ facts, reload }: { facts: any[]; reload: () => void | Promise<void> }) {
  const toast = useToast()
  const { refresh, tick } = useApp()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<any>(null)
  const [docs, setDocs] = useState<any[]>([])
  const [skipped, setSkipped] = useState<Record<string, string>>({})
  useEffect(() => { api('cv.docs').then(setDocs).catch(() => {}) }, [tick])
  const pending = facts.filter((f) => !f.confirmed)
  const importCv = async () => {
    setBusy(true)
    try {
      const path = await api('cv.pick'); if (!path) return
      const r = await api('cv.import', { path }); setNote(r); await reload(); await refresh()
      toast('ok', r.duplicate === 'exact' ? 'That exact file was already imported.' : `Found ${r.added} item${r.added === 1 ? '' : 's'} to review${r.changed ? ` and ${r.changed} that differ from what you already confirmed` : ''}. Nothing is used until you confirm it.`)
    } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const confirm = async (ids?: string[]) => {
    try {
      const r = await api('facts.confirm', { ids })
      const sk: Record<string, string> = {}; for (const s of r.skipped) sk[s.id] = s.message
      setSkipped(sk)
      if (r.skipped.length) toast('warn', `${r.skipped.length} item${r.skipped.length > 1 ? 's' : ''} could not be confirmed — see the notes below.`)
      await reload(); await refresh()
    } catch (e) { toast('bad', errMsg(e)) }
  }
  const remove = async (id: string) => { try { await api('facts.delete', { id }); await reload() } catch (e) { toast('bad', errMsg(e)) } }
  return (
    <Section id="import" title="Prefer to import?" hint="Optional shortcut: read a CV (PDF or DOCX) and review what we find. Your original file is kept unchanged and nothing is used until you confirm it."
      right={<Button size="sm" busy={busy} onClick={importCv} icon={<Upload size={14} aria-hidden />}>Import a CV</Button>}>
      {note?.warnings?.map((w: string) => <div key={w} className="mb-2"><Banner tone="warn">{w}</Banner></div>)}
      {note?.duplicate && <div className="mb-3"><Banner tone="info" title={note.duplicate === 'exact' ? 'Duplicate file' : 'Looks like a new version of a CV you already added'}>{note.duplicate_of}. Nothing you confirmed was overwritten.</Banner></div>}
      {pending.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center gap-2"><Chip tone="warn">{pending.length} to review</Chip><span className="flex-1" /><Button size="sm" variant="primary" onClick={() => confirm()} icon={<Check size={14} aria-hidden />}>Confirm all valid</Button></div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {pending.map((f) => (
              <li key={f.fact_id} className="flex gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm"><span className="font-medium">{f.title}</span> <span className="text-muted">· {CATEGORY_LABEL[f.category]}{f.organization ? ` · ${f.organization}` : ''}</span></p>
                  {f.category === 'SKILL' && f.tools.length > 0 && <p className="truncate text-xs text-muted">{f.tools.join(', ')}</p>}
                  {f.category !== 'SKILL' && f.claim_text && <p className="line-clamp-2 whitespace-pre-line text-xs text-muted">{f.claim_text}</p>}
                  {skipped[f.fact_id] && <p role="alert" className="mt-1 text-xs text-bad">{skipped[f.fact_id]}</p>}
                </div>
                <Button size="sm" variant="ghost" aria-label={`Confirm ${f.title}`} onClick={() => confirm([f.fact_id])}><Check size={15} aria-hidden /></Button>
                <Button size="sm" variant="ghost" aria-label={`Discard ${f.title}`} onClick={() => remove(f.fact_id)}><Trash2 size={15} aria-hidden /></Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">After you confirm, each item shows up in the sections above where you can edit it.</p>
        </div>
      ) : <p className="text-sm text-muted">{docs.length ? 'Nothing waiting for review.' : 'No CV imported — and none is needed. Fill in the sections above instead.'}</p>}
      {docs.length > 0 && <ul className="mt-3 divide-y divide-line text-sm">{docs.filter((d) => !d.fact_id).map((d) => <li key={d.doc_id} className="flex items-center gap-2 py-2"><FileText size={15} className="text-muted" aria-hidden /><span className="min-w-0 flex-1 truncate">{d.original_name}</span><Chip>{d.kind === 'MASTER_CV' ? 'Imported CV' : d.kind}</Chip><span className="tnum text-xs text-faint">{fmtDate(d.created_at)}</span></li>)}</ul>}
    </Section>
  )
}

// ---------------------------------------------------------------- optional evidence files
function Evidence({ facts }: { facts: any[] }) {
  const toast = useToast()
  const { tick } = useApp()
  const targets = facts.filter((f) => ['PROJECT', 'EDUCATION', 'CERTIFICATION', 'AWARD', 'EXPERIENCE'].includes(f.category) && f.confirmed)
  const [target, setTarget] = useState('')
  const [list, setList] = useState<any[]>([])
  const load = () => api('evidence.list').then(setList).catch(() => {})
  useEffect(() => { void load() }, [tick])
  const attach = async () => {
    try { const r = await api('evidence.attach', { factId: target }); if (r) { toast('ok', `Attached ${r.name}.`); void load() } } catch (e) { toast('bad', errMsg(e)) }
  }
  return (
    <Section id="evidence" title="Supporting files" hint="Optional. Attach a transcript, certificate or project write-up to one entry. PDF, PNG, JPG or DOCX, up to 10 MB. Kept on this computer and never added to a document automatically.">
      {targets.length === 0 ? <p className="text-sm text-muted">Add and confirm an entry first, then you can attach a file to it.</p> : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Attach to" className="min-w-[240px] flex-1">{(id) => <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose an entry…</option>{targets.map((f) => <option key={f.fact_id} value={f.fact_id}>{CATEGORY_LABEL[f.category]} — {f.title}</option>)}</Select>}</Field>
          <Button disabled={!target} onClick={attach} icon={<Paperclip size={14} aria-hidden />}>Choose file…</Button>
        </div>
      )}
      {list.length > 0 && <ul className="mt-3 divide-y divide-line text-sm">{list.map((d) => (
        <li key={d.doc_id} className="flex items-center gap-2 py-2"><Paperclip size={14} className="text-muted" aria-hidden /><span className="min-w-0 flex-1 truncate">{d.original_name} <span className="text-muted">→ {d.evidence_label}</span></span>
          <Button size="sm" variant="ghost" aria-label={`Remove ${d.original_name}`} onClick={async () => { await api('evidence.remove', { docId: d.doc_id }); void load() }}><Trash2 size={14} aria-hidden /></Button></li>))}</ul>}
    </Section>
  )
}

// ---------------------------------------------------------------- page
export function ProfilePage() {
  const { boot, refresh, tick } = useApp()
  const p = boot.profile
  const { facts, reload } = useFactList()
  const mine = useMemo(() => facts.filter((f: any) => f.confirmed), [facts])
  const [completion, setCompletion] = useState<any>(null)
  const [audit, setAudit] = useState<any[]>([])
  const [identity, setIdentity] = useState<any>({ ...p.identity, fullName: p.identity.fullName ?? p.name })
  const [types, setTypes] = useState<string[]>(p.career_types)
  const [prefs, setPrefs] = useState<any>(p.prefs)
  const [roles, setRoles] = useState({ roles: p.roles as string[], primary: p.primary_role as string | null, other: (p.other_role_text ?? '') as string })

  useEffect(() => { api('profile.completion').then(setCompletion).catch(() => {}); api('facts.audit').then(setAudit).catch(() => {}) }, [facts, tick])
  const basics = useAutosave({ identity, types, prefs }, async (v) => { await api('profile.update', { identity: v.identity, career_types: v.types, prefs: v.prefs }); await refresh() }, { ready: !!identity.fullName?.trim() })
  const roleSave = useAutosave(roles, async (v) => { await api('profile.update', { roles: v.roles, primary_role: v.primary, other_role_text: v.other }); await refresh() })
  const onChanged = async () => { await reload(); await refresh() }
  const doneCount = useMemo(() => completion?.items?.filter((i: any) => i.done).length ?? 0, [completion])

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">My Career Profile</p>
        <h1 className="page-title mt-1">What Career Hub knows about you</h1>
        <p className="mt-2 max-w-2xl text-muted">Everything here is yours to edit. Documents are built only from these details — and changes apply to <em>new</em> documents; files you already exported never change.</p>
      </header>

      {completion && (
        <section aria-label="Ready to tailor" className="card hero-wash mb-6 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className={cx('grid h-10 w-10 place-items-center rounded-full', completion.ready ? 'bg-ok-bg text-ok' : 'bg-primary-soft text-primary')}>{completion.ready ? <Check size={20} aria-hidden /> : <span className="tnum text-sm font-semibold">{completion.requiredDone}/{completion.requiredTotal}</span>}</div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{completion.ready ? 'Ready to tailor applications' : `${completion.requiredTotal - completion.requiredDone} basic${completion.requiredTotal - completion.requiredDone === 1 ? '' : 's'} to go before tailoring`}</p>
              <p className="text-sm text-muted">Ready means: your name, a target role, education, a skill and a project. This is a checklist, not a score of how good you are.</p>
            </div>
            {completion.next && <Button variant="primary" onClick={() => jump(completion.next.section)}>{completion.next.label}</Button>}
          </div>
          {completion.next && <p className="mt-3 text-sm"><span className="font-medium">Next useful step:</span> <span className="text-muted">{completion.next.hint}</span></p>}
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Checklist">
            {completion.items.map((i: any) => <li key={i.key}><Chip tone={i.done ? 'ok' : 'neutral'} icon={i.done ? <Check size={11} aria-hidden /> : <Circle size={9} aria-hidden />}>{i.label}{!i.required && !i.done ? ' (optional)' : ''}</Chip></li>)}
          </ul>
          <span className="sr-only">{doneCount} of {completion.items.length} items complete</span>
        </section>
      )}
      {audit.length > 0 && <div className="mb-6"><Banner tone="warn" title={`${audit.length} entr${audit.length === 1 ? 'y' : 'ies'} need a second look`}>Some saved details are in the wrong category (for example a heading saved as a skill). They are kept out of your documents until you fix them: {audit.slice(0, 2).map((a) => a.message).join(' ')}</Banner></div>}

      <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Profile sections" className="hidden lg:block"><ul className="sticky top-4 space-y-0.5 text-sm">
          {SECTIONS.map((s) => <li key={s.id}><button onClick={() => jump(s.id)} className="w-full rounded-lg px-3 py-1.5 text-left text-muted hover:bg-surface2 hover:text-ink">{s.label}</button></li>)}
          <li><button onClick={() => jump('import')} className="w-full rounded-lg px-3 py-1.5 text-left text-faint hover:bg-surface2 hover:text-ink">Import a CV</button></li>
        </ul></nav>

        <div className="min-w-0 space-y-6">
          <Section id="basics" title="Basics" right={<SavedIndicator state={basics.state} error={basics.error} />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name">{(id) => <Input id={id} value={identity.fullName ?? ''} onChange={(e) => setIdentity({ ...identity, fullName: e.target.value })} autoComplete="name" />}</Field>
              <Field label="Email">{(id) => <Input id={id} type="email" value={identity.email ?? ''} onChange={(e) => setIdentity({ ...identity, email: e.target.value })} autoComplete="email" />}</Field>
              <Field label="Phone">{(id) => <Input id={id} value={identity.phone ?? ''} onChange={(e) => setIdentity({ ...identity, phone: e.target.value })} autoComplete="tel" />}</Field>
              <Field label="Town or city" hint="Area only — never a full address.">{(id) => <Input id={id} value={identity.location ?? ''} onChange={(e) => setIdentity({ ...identity, location: e.target.value })} placeholder="Cyberjaya, Selangor" />}</Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Career stage">
              <Toggle on={types.includes('INTERNSHIP')} onClick={() => setTypes((t) => t.includes('INTERNSHIP') ? t.filter((x) => x !== 'INTERNSHIP') : [...t, 'INTERNSHIP'])}>Internship</Toggle>
              <Toggle on={types.includes('GRADUATE')} onClick={() => setTypes((t) => t.includes('GRADUATE') ? t.filter((x) => x !== 'GRADUATE') : [...t, 'GRADUATE'])}>Fresh graduate / early career</Toggle>
            </div>
            <p className="mt-3 text-xs text-muted">No photo, MyKad/NRIC, birth date, gender or marital status is ever added to documents.</p>
          </Section>

          <Section id="education" title="Education" hint="Each degree, diploma or foundation is its own entry."><EntryList category="EDUCATION" facts={mine} onChanged={onChanged} /></Section>

          <Section id="roles" title="Target roles" hint="These decide how companies are ranked for you." right={<SavedIndicator state={roleSave.state} error={roleSave.error} />}>
            <RolePicker roleFamilies={boot.roleFamilies} roles={roles.roles} primary={roles.primary} other={roles.other} onChange={setRoles} />
          </Section>

          <Section id="skills" title="Skills" hint="Skills only. Awards, activities and dates have their own sections."><SkillsEditor facts={mine} onChanged={onChanged} /></Section>
          <Section id="projects" title="Projects" hint="Your main proof. Add what you actually built, with the tools you used."><EntryList category="PROJECT" facts={mine} onChanged={onChanged} /></Section>
          <Section id="experience" title="Experience" hint="Internships, part-time or freelance work. Optional — projects can carry you."><EntryList category="EXPERIENCE" facts={mine} onChanged={onChanged} /></Section>

          <Section id="achievements" title="Achievements & activities" hint="Each one is a separate entry, so nothing gets mixed into your skills.">
            <div className="space-y-6">
              <div><h3 className="mb-2 text-sm font-semibold">Awards &amp; honours</h3><EntryList category="AWARD" facts={mine} onChanged={onChanged} /></div>
              <div><h3 className="mb-2 text-sm font-semibold">Certifications</h3><EntryList category="CERTIFICATION" facts={mine} onChanged={onChanged} /></div>
              <div><h3 className="mb-2 text-sm font-semibold">Clubs, leadership &amp; volunteering</h3><EntryList category="LEADERSHIP" facts={mine} onChanged={onChanged} /></div>
            </div>
          </Section>

          <Section id="links" title="Links" hint="Shown as clickable links on your resume." right={<SavedIndicator state={basics.state} error={basics.error} />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="GitHub">{(id) => <Input id={id} value={identity.github ?? ''} onChange={(e) => setIdentity({ ...identity, github: e.target.value })} placeholder="https://github.com/you" />}</Field>
              <Field label="LinkedIn">{(id) => <Input id={id} value={identity.linkedin ?? ''} onChange={(e) => setIdentity({ ...identity, linkedin: e.target.value })} placeholder="https://linkedin.com/in/you" />}</Field>
              <Field label="Portfolio" className="sm:col-span-2">{(id) => <Input id={id} value={identity.portfolio ?? ''} onChange={(e) => setIdentity({ ...identity, portfolio: e.target.value })} />}</Field>
            </div>
          </Section>

          <Section id="availability" title="Availability" hint="Employers ask for this first." right={<SavedIndicator state={basics.state} error={basics.error} />}><PrefsFields prefs={prefs} onChange={setPrefs} /></Section>

          <Evidence facts={facts} />
          <ImportReview facts={facts} reload={onChanged} />
          <p className="px-1 text-xs text-muted">Profiles keep each person’s details, applications and files apart inside Career Hub. They are not a lock at the operating-system level — anyone who can open this computer account could open the data. For stronger privacy, use separate Windows/macOS user accounts.</p>
        </div>
      </div>
    </div>
  )
}
