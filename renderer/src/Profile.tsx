import { useState } from 'react'
import { Check, FileText, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react'
import { api, CATEGORY_LABEL, errMsg, fmtDate } from './api'
import { useApp } from './ctx'
import { Banner, Button, Chip, Empty, Field, Input, Modal, Select, Textarea, Toggle, cx, useAsync, useToast } from './ui'

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
          <span>Primary focus:</span>
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

export function PrefsFields({ prefs, onChange, showAll }: { prefs: any; onChange: (p: any) => void; showAll?: boolean }) {
  const set = (k: string, v: any) => onChange({ ...prefs, [k]: v })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Internship starts" hint="e.g. March 2027">{(id) => <Input id={id} value={prefs.internshipStart ?? ''} onChange={(e) => set('internshipStart', e.target.value)} placeholder="March 2027" />}</Field>
      <Field label="Internship ends">{(id) => <Input id={id} value={prefs.internshipEnd ?? ''} onChange={(e) => set('internshipEnd', e.target.value)} placeholder="August 2027" />}</Field>
      <Field label="Duration available (weeks)">{(id) => <Input id={id} type="number" min={4} max={60} value={prefs.durationWeeks ?? ''} onChange={(e) => set('durationWeeks', e.target.value ? Number(e.target.value) : undefined)} placeholder="24" />}</Field>
      <Field label="Work arrangement">{(id) => <Select id={id} value={prefs.workMode ?? ''} onChange={(e) => set('workMode', e.target.value)}><option value="">No preference</option><option value="onsite">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></Select>}</Field>
      <Field label="University">{(id) => <Input id={id} value={prefs.university ?? ''} onChange={(e) => set('university', e.target.value)} />}</Field>
      <Field label="Expected graduation">{(id) => <Input id={id} value={prefs.graduation ?? ''} onChange={(e) => set('graduation', e.target.value)} placeholder="July 2027" />}</Field>
      <Field label="Allowance / salary expectation" hint="Private. Used only to guide wording.">{(id) => <Input id={id} value={prefs.expectation ?? ''} onChange={(e) => set('expectation', e.target.value)} placeholder="RM1,200+ per month" />}</Field>
      <Field label="Citizenship" hint="Lets the match check citizenship requirements.">{(id) => <Select id={id} value={prefs.citizenship ?? ''} onChange={(e) => set('citizenship', e.target.value)}><option value="">Prefer not to say</option><option value="malaysian">Malaysian</option><option value="other">Other</option></Select>}</Field>
      {showAll && <Field label="Language for documents">{(id) => <Select id={id} value={prefs.language ?? 'en'} onChange={(e) => set('language', e.target.value)}><option value="en">English</option><option value="ms">Bahasa Malaysia</option></Select>}</Field>}
    </div>
  )
}

// ---------------------------------------------------------------- fact bank
const CATS = ['EDUCATION', 'SKILL', 'PROJECT', 'EXPERIENCE', 'LEADERSHIP', 'CERTIFICATION', 'AWARD', 'LANGUAGE']

function FactModal({ fact, onClose, onSaved }: { fact: any | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState<any>(fact ?? { category: 'PROJECT', title: '', organization: '', date_start: '', date_end: '', claim_text: '', tools: [] })
  const [tools, setTools] = useState((fact?.tools ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }))
  const save = async () => {
    setBusy(true)
    try { await api('facts.save', { ...f, tools: tools.split(',').map((s: string) => s.trim()).filter(Boolean), confirmed: true }); onSaved(); onClose() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const skill = f.category === 'SKILL' || f.category === 'LANGUAGE'
  return (
    <Modal title={fact ? 'Edit detail' : 'Add a detail'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!f.title.trim()} onClick={save}>Save & confirm</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">{(id) => <Select id={id} value={f.category} onChange={(e) => set('category', e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select>}</Field>
        <Field label={skill ? 'Group name' : 'Title'}>{(id) => <Input id={id} data-autofocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder={skill ? 'Languages' : 'Project or role name'} />}</Field>
        {!skill && <Field label={f.category === 'EDUCATION' ? 'University' : 'Organisation (optional)'}>{(id) => <Input id={id} value={f.organization ?? ''} onChange={(e) => set('organization', e.target.value)} />}</Field>}
        {!skill && <div className="grid grid-cols-2 gap-3"><Field label="Start">{(id) => <Input id={id} value={f.date_start ?? ''} onChange={(e) => set('date_start', e.target.value)} placeholder="Jan 2025" />}</Field><Field label="End">{(id) => <Input id={id} value={f.date_end ?? ''} onChange={(e) => set('date_end', e.target.value)} placeholder="Present" />}</Field></div>}
      </div>
      <Field className="mt-3" label={skill ? 'Items (comma separated)' : 'What you did — one point per line'} hint={skill ? 'Only list what you can honestly discuss.' : 'Describe real work. Add numbers only if they are true — nothing is invented for you.'}>
        {(id) => skill ? <Input id={id} value={tools} onChange={(e) => setTools(e.target.value)} placeholder="Python, SQL, Git" /> : <Textarea id={id} rows={5} value={f.claim_text} onChange={(e) => set('claim_text', e.target.value)} />}
      </Field>
      {!skill && <Field className="mt-3" label="Technologies used (comma separated)" hint="Only tools you actually used here.">{(id) => <Input id={id} value={tools} onChange={(e) => setTools(e.target.value)} placeholder="Python, React" />}</Field>}
    </Modal>
  )
}

export function FactsReview({ facts, reload, compact }: { facts: any[]; reload: () => void; compact?: boolean }) {
  const toast = useToast()
  const [edit, setEdit] = useState<any | null | 'new'>(null)
  const del = async (id: string) => { try { await api('facts.delete', { id }); reload() } catch (e) { toast('bad', errMsg(e)) } }
  const confirm = async (ids?: string[]) => { try { await api('facts.confirm', { ids }); reload() } catch (e) { toast('bad', errMsg(e)) } }
  const unconfirmed = facts.filter((f) => !f.confirmed).length
  const groups = CATS.map((c) => [c, facts.filter((f) => f.category === c)] as const).filter(([, l]) => l.length)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {unconfirmed > 0 ? <Chip tone="warn" icon={<span aria-hidden>!</span>}>{unconfirmed} to confirm</Chip> : facts.length > 0 && <Chip tone="ok" icon={<Check size={12} aria-hidden />}>All confirmed</Chip>}
        <span className="flex-1" />
        <Button size="sm" onClick={() => setEdit('new')} icon={<Plus size={14} aria-hidden />}>Add detail</Button>
        {unconfirmed > 0 && <Button size="sm" variant="primary" onClick={() => confirm()} icon={<Check size={14} aria-hidden />}>Confirm all</Button>}
      </div>
      {facts.length === 0 && <Empty title="No details yet" icon={<FileText size={20} aria-hidden />}>Import your CV or add your education, skills and projects by hand. Documents are built only from details you confirm.</Empty>}
      <div className={cx('space-y-5', compact && 'max-h-[46vh] overflow-y-auto pr-1 scroll-thin')}>
        {groups.map(([cat, list]) => (
          <section key={cat} aria-label={CATEGORY_LABEL[cat]}>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{CATEGORY_LABEL[cat]}</h4>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {list.map((f) => (
                <li key={f.fact_id} className="flex gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium">{f.title}</span>
                      {f.organization && <span className="text-sm text-muted">· {f.organization}</span>}
                      {(f.date_start || f.date_end) && <span className="tnum text-xs text-faint">{[f.date_start, f.date_end].filter(Boolean).join(' – ')}</span>}
                      {!f.confirmed && <Chip tone="warn">Needs review</Chip>}
                    </div>
                    {f.claim_text && <p className="mt-1 whitespace-pre-line text-sm text-muted">{f.claim_text}</p>}
                    {f.tools.length > 0 && cat !== 'SKILL' && cat !== 'LANGUAGE' && <div className="mt-1.5 flex flex-wrap gap-1">{f.tools.map((t: string) => <Chip key={t}>{t}</Chip>)}</div>}
                    <p className="mt-1 text-xs text-faint">{f.source_citation === 'manual' ? 'Added by you' : `From your CV (${f.source_citation.replace(/^cv:[^#]*#/, '').replace(/^L/, 'lines ')}) · ${f.confidence} confidence`}</p>
                  </div>
                  <div className="flex shrink-0 items-start gap-0.5">
                    {!f.confirmed && <Button size="sm" variant="ghost" aria-label={`Confirm ${f.title}`} onClick={() => confirm([f.fact_id])}><Check size={15} aria-hidden /></Button>}
                    <Button size="sm" variant="ghost" aria-label={`Edit ${f.title}`} onClick={() => setEdit(f)}><Pencil size={15} aria-hidden /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Remove ${f.title}`} onClick={() => del(f.fact_id)}><Trash2 size={15} aria-hidden /></Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {edit && <FactModal fact={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  )
}

export function IdentityFields({ identity, onChange }: { identity: any; onChange: (i: any) => void }) {
  const set = (k: string, v: string) => onChange({ ...identity, [k]: v })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Full name">{(id) => <Input id={id} value={identity.fullName ?? ''} onChange={(e) => set('fullName', e.target.value)} autoComplete="name" />}</Field>
      <Field label="Email">{(id) => <Input id={id} type="email" value={identity.email ?? ''} onChange={(e) => set('email', e.target.value)} autoComplete="email" />}</Field>
      <Field label="Phone">{(id) => <Input id={id} value={identity.phone ?? ''} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />}</Field>
      <Field label="Location">{(id) => <Input id={id} value={identity.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="Cyberjaya, Selangor" />}</Field>
      <Field label="GitHub">{(id) => <Input id={id} value={identity.github ?? ''} onChange={(e) => set('github', e.target.value)} placeholder="https://github.com/you" />}</Field>
      <Field label="LinkedIn">{(id) => <Input id={id} value={identity.linkedin ?? ''} onChange={(e) => set('linkedin', e.target.value)} placeholder="https://linkedin.com/in/you" />}</Field>
      <Field label="Portfolio (optional)" className="sm:col-span-2">{(id) => <Input id={id} value={identity.portfolio ?? ''} onChange={(e) => set('portfolio', e.target.value)} />}</Field>
    </div>
  )
}

// ---------------------------------------------------------------- page
export function ProfilePage() {
  const { boot, refresh, tick } = useApp()
  const toast = useToast()
  const p = boot.profile
  const facts = useAsync(() => api('facts.list'), [tick])
  const docs = useAsync(() => api('cv.docs'), [tick])
  const [roles, setRoles] = useState({ roles: p.roles as string[], primary: p.primary_role as string | null, other: (p.other_role_text ?? '') as string })
  const [types, setTypes] = useState<string[]>(p.career_types)
  const [prefs, setPrefs] = useState<any>(p.prefs)
  const [identity, setIdentity] = useState<any>(p.identity)
  const [region, setRegion] = useState(p.region)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [note, setNote] = useState<any>(null)

  const save = async () => {
    if (!roles.roles.length) return toast('warn', 'Choose at least one role.')
    if (!types.length) return toast('warn', 'Choose Internship, Graduate / Entry-level, or both.')
    setBusy(true)
    try { await api('profile.update', { roles: roles.roles, primary_role: roles.primary, other_role_text: roles.other, career_types: types, region, prefs, identity }); await refresh(); toast('ok', 'Profile saved') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  const importCv = async () => {
    setImporting(true)
    try {
      const path = await api('cv.pick'); if (!path) return
      const r = await api('cv.import', { path }); setNote(r); setIdentity(r.identity); await refresh()
      toast('ok', r.duplicate === 'exact' ? 'That exact file was already imported.' : `Found ${r.added} new detail${r.added === 1 ? '' : 's'} to review${r.changed ? ` and ${r.changed} that differ from what you confirmed` : ''}.`)
    } catch (e) { toast('bad', errMsg(e)) } finally { setImporting(false) }
  }

  return (
    <div>
      <header className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">My Profile</h1><p className="mt-1 text-muted">One honest source of truth. Every document is built only from details you have confirmed here.</p></header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-6">
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-3 font-semibold">Role focus</h2>
            <RolePicker roleFamilies={boot.roleFamilies} roles={roles.roles} primary={roles.primary} other={roles.other} onChange={setRoles} />
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Career stage">
              <Toggle on={types.includes('INTERNSHIP')} onClick={() => setTypes((t) => t.includes('INTERNSHIP') ? t.filter((x) => x !== 'INTERNSHIP') : [...t, 'INTERNSHIP'])}>Internship</Toggle>
              <Toggle on={types.includes('GRADUATE')} onClick={() => setTypes((t) => t.includes('GRADUATE') ? t.filter((x) => x !== 'GRADUATE') : [...t, 'GRADUATE'])}>Graduate / Entry-level</Toggle>
            </div>
            <Field className="mt-4 max-w-xs" label="Target region">{(id) => <Input id={id} value={region} onChange={(e) => setRegion(e.target.value)} />}</Field>
          </section>
          <section className="rounded-xl border border-line bg-surface p-5"><h2 className="mb-3 font-semibold">Availability & preferences</h2><PrefsFields prefs={prefs} onChange={setPrefs} /></section>
          <section className="rounded-xl border border-line bg-surface p-5"><h2 className="mb-3 font-semibold">Contact details on documents</h2><IdentityFields identity={identity} onChange={setIdentity} /><p className="mt-3 text-xs text-muted">No photo, MyKad/NRIC, birth date or marital status is ever added to documents.</p></section>
          <div className="sticky bottom-3 z-10 flex justify-end"><Button variant="primary" busy={busy} onClick={save} className="shadow-md">Save changes</Button></div>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-line bg-surface p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="flex-1 font-semibold">CV versions</h2><Button size="sm" busy={importing} onClick={importCv} icon={<Upload size={14} aria-hidden />}>Import / update CV</Button></div>
            {note?.duplicate && <div className="mb-3"><Banner tone="info" title={note.duplicate === 'exact' ? 'Duplicate file' : 'Looks like a new version of a CV you already added'}>{note.duplicate_of}. {note.duplicate === 'near' && 'New or changed details are listed below as “Needs review”; nothing you confirmed was overwritten.'}</Banner></div>}
            {note?.warnings?.map((w: string) => <div key={w} className="mb-2"><Banner tone="warn">{w}</Banner></div>)}
            {!docs.data?.length ? <p className="text-sm text-muted">No CV imported yet. Your original file is kept unchanged when you import one.</p> : (
              <ul className="divide-y divide-line text-sm">{docs.data.map((d: any) => <li key={d.doc_id} className="flex items-center gap-2 py-2"><FileText size={15} className="text-muted" aria-hidden /><span className="min-w-0 flex-1 truncate">{d.original_name}</span><Chip>{d.kind === 'MASTER_CV' ? 'Master CV' : d.kind}</Chip><span className="tnum text-xs text-faint">{fmtDate(d.created_at)}</span></li>)}</ul>
            )}
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-3 font-semibold">Confirmed facts</h2>
            <FactsReview facts={facts.data ?? []} reload={() => { facts.reload(); void refresh() }} />
          </section>
        </div>
      </div>
    </div>
  )
}
