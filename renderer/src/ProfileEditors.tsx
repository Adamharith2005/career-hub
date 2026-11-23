import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { api, errMsg } from './api'
import { useApp } from './ctx'
import { ChipInput, SavedIndicator, useAutosave } from './kit'
import { Button, Field, Input, Select, Textarea, cx, useToast } from './ui'

/** Loads this profile's records and reloads on demand. Every list below edits one category of them. */
export function useFactList() {
  const { tick, refresh } = useApp()
  const [facts, setFacts] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const reload = useCallback(async () => { setFacts(await api('facts.list')); setLoaded(true) }, [])
  useEffect(() => { void reload() }, [reload, tick])
  return { facts, loaded, reload, reloadAll: async () => { await reload(); await refresh() } }
}

// ------------------------------------------------------------------ field config
interface FieldDef {
  key: string; label: string; where: 'top' | 'details' | 'metrics' | 'tools' | 'coursework'
  kind: 'text' | 'select' | 'textarea' | 'chips'
  placeholder?: string; hint?: string; options?: [string, string][]; span?: 1 | 2; rows?: number; required?: boolean
}
interface EntryConfig {
  category: string; singular: string; addLabel: string; empty: string; reorder?: boolean
  fields: FieldDef[]; heading: (d: Draft) => string; sub?: (d: Draft) => string
}
interface Draft { title: string; organization: string; date_start: string; date_end: string; claim_text: string; tools: string[]; metrics: string[]; details: Record<string, any> }

const blank = (): Draft => ({ title: '', organization: '', date_start: '', date_end: '', claim_text: '', tools: [], metrics: [], details: {} })
const fromFact = (f: any): Draft => ({
  title: f.title ?? '', organization: f.organization ?? '', date_start: f.date_start ?? '', date_end: f.date_end ?? '', claim_text: f.claim_text ?? '',
  tools: f.tools ?? [], metrics: f.metrics ?? [], details: f.details ?? {},
})
const joinDates = (d: Draft) => [d.date_start, d.date_end].filter(Boolean).join(' – ')

const CGPA_SCALES: [string, string][] = [['', 'Scale…'], ['4.0', 'out of 4.0'], ['5.0', 'out of 5.0'], ['100', 'out of 100 (%)']]
export const CONFIGS: Record<string, EntryConfig> = {
  EDUCATION: {
    category: 'EDUCATION', singular: 'education', addLabel: 'Add education', empty: 'Where do you study? Add your university or college — add a diploma or foundation too if you like.', reorder: true,
    heading: (d) => d.title || 'New education', sub: (d) => [d.organization, joinDates(d)].filter(Boolean).join(' · '),
    fields: [
      { key: 'organization', label: 'Institution', where: 'top', kind: 'text', required: true, placeholder: 'e.g. Multimedia University', span: 2 },
      { key: 'title', label: 'Programme', where: 'top', kind: 'text', required: true, placeholder: 'e.g. Bachelor of Computer Science (Hons)', span: 2 },
      { key: 'level', label: 'Level', where: 'details', kind: 'select', options: [['', 'Choose…'], ['Foundation', 'Foundation'], ['Diploma', 'Diploma'], ['Bachelor', 'Bachelor’s degree'], ['Master', 'Master’s'], ['PhD', 'PhD'], ['Other', 'Other']] },
      { key: 'date_start', label: 'Started', where: 'top', kind: 'text', placeholder: '2023' },
      { key: 'date_end', label: 'Graduation (expected or actual)', where: 'top', kind: 'text', placeholder: '2027' },
      { key: 'cgpa', label: 'CGPA / GPA (optional)', where: 'details', kind: 'text', placeholder: '3.62', hint: 'Only if you want it shown.' },
      { key: 'cgpaScale', label: 'Scale', where: 'details', kind: 'select', options: CGPA_SCALES },
      { key: 'coursework', label: 'Relevant coursework (optional)', where: 'coursework', kind: 'chips', placeholder: 'Data Structures, Databases…', span: 2 },
    ],
  },
  PROJECT: {
    category: 'PROJECT', singular: 'project', addLabel: 'Add another project', empty: 'Projects are your strongest proof. Add one you built — a course project counts.', reorder: true,
    heading: (d) => d.title || 'New project', sub: (d) => [d.details.projectType, joinDates(d)].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Project name', where: 'top', kind: 'text', required: true, placeholder: 'e.g. Campus Events App', span: 2 },
      { key: 'projectType', label: 'Type', where: 'details', kind: 'select', options: [['', 'Choose…'], ['academic', 'Academic'], ['personal', 'Personal'], ['hackathon', 'Hackathon'], ['commercial', 'Commercial / client']] },
      { key: 'role', label: 'Your role', where: 'details', kind: 'text', placeholder: 'Solo developer, or team of 4 — backend' },
      { key: 'purpose', label: 'What was it for?', where: 'details', kind: 'text', placeholder: 'One sentence on the problem it solved', span: 2 },
      { key: 'claim_text', label: 'What you actually built', where: 'top', kind: 'textarea', rows: 4, placeholder: 'One point per line, e.g.\nBuilt a React front end and an Express API for event sign-up', hint: 'These become resume bullets. Only write what is true — nothing is invented for you.', span: 2 },
      { key: 'tools', label: 'Tech stack', where: 'tools', kind: 'chips', placeholder: 'React, Node.js, SQL…', hint: 'Only tools you actually used here.', span: 2 },
      { key: 'outcome', label: 'Outcome (optional)', where: 'details', kind: 'text', placeholder: 'What happened? Skip it if you are not sure.', span: 2 },
      { key: 'metrics', label: 'Honest numbers (optional)', where: 'metrics', kind: 'chips', placeholder: 'e.g. 40 beta users', hint: 'Only figures you can back up. Leave empty otherwise.', span: 2 },
      { key: 'date_start', label: 'Started', where: 'top', kind: 'text', placeholder: 'Jan 2025' },
      { key: 'date_end', label: 'Finished', where: 'top', kind: 'text', placeholder: 'Mar 2025 or Present' },
      { key: 'url', label: 'Repo / demo link (optional)', where: 'details', kind: 'text', placeholder: 'https://github.com/you/project', span: 2 },
    ],
  },
  EXPERIENCE: {
    category: 'EXPERIENCE', singular: 'experience', addLabel: 'Add experience', empty: 'No work history yet? That is fine — projects can carry your application.', reorder: true,
    heading: (d) => d.title || 'New experience', sub: (d) => [d.organization, joinDates(d)].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Role', where: 'top', kind: 'text', required: true, placeholder: 'e.g. IT Support Intern' },
      { key: 'organization', label: 'Organisation', where: 'top', kind: 'text', required: true },
      { key: 'employmentType', label: 'Type', where: 'details', kind: 'select', options: [['', 'Choose…'], ['internship', 'Internship'], ['part-time', 'Part-time'], ['full-time', 'Full-time'], ['freelance', 'Freelance'], ['volunteer', 'Volunteer']] },
      { key: 'date_start', label: 'Started', where: 'top', kind: 'text', placeholder: 'Jun 2024' },
      { key: 'date_end', label: 'Ended', where: 'top', kind: 'text', placeholder: 'Aug 2024 or Present' },
      { key: 'claim_text', label: 'What you did', where: 'top', kind: 'textarea', rows: 3, placeholder: 'One point per line', span: 2, hint: 'Real work only; add numbers only if true.' },
    ],
  },
  LEADERSHIP: {
    category: 'LEADERSHIP', singular: 'activity', addLabel: 'Add activity', empty: 'Clubs, events, volunteering or leadership — each one is its own entry.',
    heading: (d) => d.title || 'New activity', sub: (d) => [d.organization, joinDates(d)].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Role or activity', where: 'top', kind: 'text', required: true, placeholder: 'e.g. Treasurer' },
      { key: 'organization', label: 'Club / organisation', where: 'top', kind: 'text' },
      { key: 'date_start', label: 'Started', where: 'top', kind: 'text', placeholder: '2024' },
      { key: 'date_end', label: 'Ended', where: 'top', kind: 'text', placeholder: '2025 or Present' },
      { key: 'claim_text', label: 'What you did', where: 'top', kind: 'textarea', rows: 2, placeholder: 'One point per line', span: 2 },
    ],
  },
  CERTIFICATION: {
    category: 'CERTIFICATION', singular: 'certification', addLabel: 'Add certification', empty: 'Certificates and courses you have actually completed.',
    heading: (d) => d.title || 'New certification', sub: (d) => [d.organization, d.date_end].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Certification', where: 'top', kind: 'text', required: true, placeholder: 'e.g. AWS Cloud Practitioner', span: 2 },
      { key: 'organization', label: 'Issued by', where: 'top', kind: 'text' },
      { key: 'date_end', label: 'Year', where: 'top', kind: 'text', placeholder: '2025' },
    ],
  },
  AWARD: {
    category: 'AWARD', singular: 'award', addLabel: 'Add award or honour', empty: 'Dean’s List, scholarships, competition results — each as its own entry.',
    heading: (d) => d.title || 'New award', sub: (d) => [d.organization, d.date_end].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Award or honour', where: 'top', kind: 'text', required: true, placeholder: 'e.g. Dean’s List', span: 2 },
      { key: 'organization', label: 'Awarded by', where: 'top', kind: 'text' },
      { key: 'date_end', label: 'Year', where: 'top', kind: 'text', placeholder: '2024' },
    ],
  },
}

// ------------------------------------------------------------------ one entry card (autosaves when valid)
function EntryCard({ cfg, initial, factId, onSaved, onRemove, onMove, canUp, canDown, techNames, autoFocus }: {
  cfg: EntryConfig; initial: Draft; factId: string | null; onSaved: (id: string) => void; onRemove: (snapshot: Draft, id: string | null) => void
  onMove: (d: -1 | 1) => void; canUp: boolean; canDown: boolean; techNames: string[]; autoFocus?: boolean
}) {
  const [d, setD] = useState<Draft>(initial)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const idRef = useRef<string | null>(factId)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (autoFocus) rootRef.current?.querySelector<HTMLElement>('input,textarea,select')?.focus() }, [autoFocus])
  const required = cfg.fields.filter((f) => f.required)
  const missing = required.filter((f) => !String((f.where === 'top' ? (d as any)[f.key] : d.details[f.key]) ?? '').trim())
  const valid = missing.length === 0
  const save = useAutosave(d, async (v) => {
    const id = await api('facts.save', { fact_id: idRef.current ?? undefined, category: cfg.category, title: v.title, organization: v.organization || null, date_start: v.date_start || null, date_end: v.date_end || null,
      claim_text: v.claim_text, tools: v.tools, metrics: v.metrics, details: v.details, confirmed: true })
    idRef.current = id; onSaved(id)
  }, { ready: valid })

  const get = (f: FieldDef) => f.where === 'top' ? (d as any)[f.key] ?? '' : f.where === 'tools' ? d.tools : f.where === 'metrics' ? d.metrics : f.where === 'coursework' ? (d.details.coursework ?? []) : d.details[f.key] ?? ''
  const set = (f: FieldDef, v: any) => setD((x) => f.where === 'top' ? { ...x, [f.key]: v } : f.where === 'tools' ? { ...x, tools: v } : f.where === 'metrics' ? { ...x, metrics: v } : f.where === 'coursework' ? { ...x, details: { ...x.details, coursework: v } } : { ...x, details: { ...x.details, [f.key]: v } })

  return (
    <div ref={rootRef} className="card anim-fade-up p-4" role="group" aria-label={`${cfg.singular}: ${cfg.heading(d)}`}>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1"><p className="truncate font-semibold">{cfg.heading(d)}</p>{cfg.sub && <p className="truncate text-xs text-muted">{cfg.sub(d)}</p>}</div>
        <SavedIndicator state={valid ? save.state : 'idle'} error={save.error} />
        {cfg.reorder && <>
          <Button size="sm" variant="ghost" aria-label={`Move ${cfg.heading(d)} up`} disabled={!canUp} onClick={() => onMove(-1)}><ArrowUp size={15} aria-hidden /></Button>
          <Button size="sm" variant="ghost" aria-label={`Move ${cfg.heading(d)} down`} disabled={!canDown} onClick={() => onMove(1)}><ArrowDown size={15} aria-hidden /></Button>
        </>}
        <Button size="sm" variant="ghost" aria-label={`Remove ${cfg.heading(d)}`} onClick={() => onRemove(d, idRef.current)}><Trash2 size={15} aria-hidden /></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cfg.fields.map((f) => {
          const err = f.required && touched[f.key] && !String(get(f)).trim() ? 'Required — this is how we recognise the entry.' : undefined
          return (
            <div key={f.key} className={cx(f.span === 2 && 'sm:col-span-2')}>
              {f.kind === 'chips'
                ? <ChipInput label={f.label} values={get(f)} onChange={(v) => set(f, v)} suggestions={f.where === 'tools' || f.where === 'coursework' ? techNames : []} placeholder={f.placeholder} hint={f.hint} />
                : <Field label={f.label + (f.required ? ' *' : '')} hint={f.hint} error={err}>
                  {(id) => f.kind === 'select'
                    ? <Select id={id} value={get(f)} onChange={(e) => set(f, e.target.value)}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                    : f.kind === 'textarea'
                      ? <Textarea id={id} rows={f.rows ?? 3} value={get(f)} placeholder={f.placeholder} onChange={(e) => set(f, e.target.value)} onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))} />
                      : <Input id={id} value={get(f)} placeholder={f.placeholder} onChange={(e) => set(f, e.target.value)} onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))} aria-required={f.required} />}
                </Field>}
            </div>
          )
        })}
      </div>
      {!valid && <p className="mt-2 text-xs text-muted">Fill in {missing.map((m) => m.label.toLowerCase()).join(' and ')} and this entry saves itself.</p>}
    </div>
  )
}

// ------------------------------------------------------------------ list of entries for one category
interface Row { uid: string; factId: string | null; initial: Draft; fresh?: boolean }
let uidSeq = 0

export function EntryList({ category, facts, onChanged }: { category: keyof typeof CONFIGS; facts: any[]; onChanged: () => void | Promise<void> }) {
  const cfg = CONFIGS[category]
  const { boot } = useApp()
  const toast = useToast()
  const mine = facts.filter((f) => f.category === cfg.category)
  const [rows, setRows] = useState<Row[]>(() => mine.map((f) => ({ uid: f.fact_id, factId: f.fact_id, initial: fromFact(f) })))
  // keep in sync when records appear/disappear elsewhere (CV import review, another list), without disturbing cards being edited
  useEffect(() => {
    setRows((rs) => {
      const have = new Set(rs.map((r) => r.factId).filter(Boolean))
      const add = mine.filter((f) => !have.has(f.fact_id)).map((f) => ({ uid: f.fact_id, factId: f.fact_id, initial: fromFact(f) }))
      const live = new Set(mine.map((f) => f.fact_id))
      const kept = rs.filter((r) => !r.factId || live.has(r.factId))
      return add.length || kept.length !== rs.length ? [...kept, ...add] : rs
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts])

  const orderedIds = (rs: Row[]) => rs.map((r) => r.factId).filter(Boolean) as string[]
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= rows.length) return
    const next = [...rows];[next[i], next[j]] = [next[j], next[i]]
    setRows(next)
    try { await api('facts.reorder', { ids: orderedIds(next) }); await onChanged() } catch (e) { toast('bad', errMsg(e)) }
  }
  const remove = async (i: number, snapshot: Draft, id: string | null) => {
    setRows((rs) => rs.filter((_, k) => k !== i))
    if (!id) return
    try {
      await api('facts.delete', { id }); await onChanged()
      toast('ok', `Removed “${cfg.heading(snapshot)}”.`, { label: 'Undo', onClick: async () => {
        try {
          const nid = await api('facts.save', { category: cfg.category, title: snapshot.title, organization: snapshot.organization || null, date_start: snapshot.date_start || null, date_end: snapshot.date_end || null,
            claim_text: snapshot.claim_text, tools: snapshot.tools, metrics: snapshot.metrics, details: snapshot.details, confirmed: true })
          setRows((rs) => [...rs.slice(0, i), { uid: nid, factId: nid, initial: snapshot }, ...rs.slice(i)]); await onChanged()
        } catch (e) { toast('bad', errMsg(e)) }
      } })
    } catch (e) { toast('bad', errMsg(e)) }
  }
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="card-soft px-4 py-3 text-sm text-muted">{cfg.empty}</p>}
      {rows.map((r, i) => (
        <EntryCard key={r.uid} cfg={cfg} initial={r.initial} factId={r.factId} techNames={boot.techNames ?? []} autoFocus={r.fresh}
          canUp={i > 0} canDown={i < rows.length - 1} onMove={(d) => move(i, d)}
          onSaved={(id) => { setRows((rs) => rs.map((x) => (x.uid === r.uid ? { ...x, factId: id, fresh: false } : x))); void onChanged() }}
          onRemove={(snap, id) => remove(i, snap, id)} />
      ))}
      <Button onClick={() => setRows((rs) => [...rs, { uid: `new${++uidSeq}`, factId: null, initial: blank(), fresh: true }])} icon={<Plus size={15} aria-hidden />}>{cfg.addLabel}</Button>
    </div>
  )
}

// ------------------------------------------------------------------ skills by category (chips; reorder; autosave)
export const SKILL_GROUPS: { title: string; hint: string }[] = [
  { title: 'Languages', hint: 'Programming and query languages, e.g. Python, Java, SQL' },
  { title: 'Frameworks', hint: 'e.g. React, Spring Boot, Django' },
  { title: 'Data & AI', hint: 'e.g. Pandas, Power BI, TensorFlow' },
  { title: 'Cloud & DevOps', hint: 'e.g. Docker, AWS, GitHub Actions' },
  { title: 'Security', hint: 'e.g. Wireshark, Nmap, OWASP Top 10' },
  { title: 'Tools', hint: 'e.g. Git, Linux, Figma, Postman' },
  { title: 'Collaboration & Other', hint: 'e.g. Agile, Teamwork, Technical writing' },
]

function SkillGroup({ title, hint, fact, techNames, onChanged }: { title: string; hint: string; fact: any | null; techNames: string[]; onChanged: () => void | Promise<void> }) {
  const [values, setValues] = useState<string[]>(fact?.tools ?? [])
  const idRef = useRef<string | null>(fact?.fact_id ?? null)
  const toast = useToast()
  const save = useAutosave(values, async (v) => {
    try {
      if (!v.length) { if (idRef.current) { await api('facts.delete', { id: idRef.current }); idRef.current = null; await onChanged() } return }
      idRef.current = await api('facts.save', { fact_id: idRef.current ?? undefined, category: 'SKILL', title, tools: v, confirmed: true })
      await onChanged()
    } catch (e) { toast('bad', errMsg(e)); throw e }
  })
  return (
    <div>
      <ChipInput label={title} values={values} onChange={setValues} suggestions={techNames} placeholder="Type a skill and press Enter" hint={hint} />
      <div className="mt-0.5 text-right"><SavedIndicator state={save.state} error={save.error} /></div>
    </div>
  )
}

export function SkillsEditor({ facts, onChanged }: { facts: any[]; onChanged: () => void | Promise<void> }) {
  const { boot } = useApp()
  const skills = facts.filter((f) => f.category === 'SKILL')
  const known = new Set(SKILL_GROUPS.map((g) => g.title))
  const others = skills.filter((f) => !known.has(f.title))
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {SKILL_GROUPS.map((g) => <SkillGroup key={g.title} title={g.title} hint={g.hint} fact={skills.find((f) => f.title === g.title) ?? null} techNames={boot.techNames ?? []} onChanged={onChanged} />)}
      {others.map((f) => <SkillGroup key={f.fact_id} title={f.title} hint="Imported group" fact={f} techNames={boot.techNames ?? []} onChanged={onChanged} />)}
    </div>
  )
}
