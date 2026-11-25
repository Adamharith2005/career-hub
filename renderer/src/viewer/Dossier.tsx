import { useState } from 'react'
import { ExternalLink, FileText, Globe, Mail, Wand2 } from 'lucide-react'
import { api } from '../api'
import { Button, Modal, cx } from '../ui'
import { CopyButton, CopyIcon } from './Copy'
import { DocViewer, useDocs } from './Docs'
import { EmailDraft } from './Email'
import { allowanceMark, evidenceMark, Mark, officeMark } from './Marks'
import { ALLOWANCE_LABEL, CLASS_LABEL, EVIDENCE_LABEL, OFFICE_LABEL, TECH_LABEL } from './labels'
import { useV } from './vctx'
import { MatchPanel, type RoleInfo } from './Match'
import { CvStudio } from './CvStudio'
import { ContactPanel } from './ContactPanel'
import { ROLE_OPTIONS } from './labels'

const SECTOR = { GOVERNMENT: 'Government', NON_GOVERNMENT: 'Non-government', UNKNOWN: 'Unclassified' } as const

/** One labelled fact. The copy action sits beside the value and appears on hover or keyboard focus. */
function Fact({ label, value, copy, link, mono, empty = 'Not verified' }: { label: string; value?: React.ReactNode; copy?: string | null; link?: string | null; mono?: boolean; empty?: string }) {
  const has = value != null && value !== '' && value !== false
  return (
    <div className="has-reveal grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-line/70 py-2 text-sm last:border-b-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={cx('min-w-0', mono ? 'font-mono text-[13px] [overflow-wrap:anywhere]' : 'break-words', !has && 'text-faint')}>{has ? value : empty}</dd>
      <span className="reveal-copy flex items-center self-center">
        {has && link && <button aria-label={`Open ${label}`} title="Open in browser" onClick={() => api('v.openExternal', { url: link })} className="press grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-surface2 hover:text-ink"><ExternalLink size={14} aria-hidden /></button>}
        {has && copy && <CopyIcon text={copy} label={label.toLowerCase()} />}
      </span>
    </div>
  )
}

/** A chapter of the dossier: a short label in the margin, the facts beside it. No boxes. */
function Chapter({ title, note, children, id }: { title: string; note?: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="grid grid-cols-[10.5rem_minmax(0,1fr)] gap-x-8 border-t border-line py-5 max-[1100px]:grid-cols-1 max-[1100px]:gap-y-2">
      <div><h3 id={id} className="text-[15px] font-semibold">{title}</h3>{note && <p className="mt-1 text-[12.5px] leading-snug text-muted">{note}</p>}</div>
      <dl className="min-w-0">{children}</dl>
    </section>
  )
}

export function Dossier({ c }: { c: any }) {
  const { profileId, profile } = useV()
  const { docs } = useDocs(profileId)
  const [showDoc, setShowDoc] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [studio, setStudio] = useState(false)
  const [cx, setCx] = useState(c)
  const [recipientKey, setRecipientKey] = useState<string | null>(null)
  const useEmail = (key: string) => { setRecipientKey(key); document.getElementById('s-email')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const a = c.allowance, i = c.internship, k = c.contacts
  const office = c.offices[0]
  const cs = cx.contactSummary
  const bestEmail = cs?.best?.kind === 'EMAIL' && cs.state !== 'PENDING' ? cs.best.value : null
  const amount = a.monthlyMin != null ? `${a.monthlyMin}${a.monthlyMax && a.monthlyMax !== a.monthlyMin ? `–${a.monthlyMax}` : ''}` : null
  const kind = [c.city, SECTOR[c.sector as keyof typeof SECTOR], ...c.classes.map((x: string) => CLASS_LABEL[x] ?? x)].filter(Boolean).join(' · ')
  return (
    <article key={c.id} className="anim-detail pb-12" data-testid="dossier" aria-label={`${c.name} details`}>
      <header>
        <p className="text-[13px] text-muted">{kind}</p>
        <h2 className="font-display mt-1.5 text-[2.4rem] leading-[1.06] tracking-[-0.01em]" data-testid="dossier-title">{c.name}</h2>
        {c.legalEntity && c.legalEntity !== c.name && <p className="mt-1 text-[14px] text-muted">{c.legalEntity}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-1.5">
          <Button variant="primary" size="sm" onClick={() => setStudio(true)} disabled={!role} icon={<Wand2 size={14} aria-hidden />} data-testid="tailor-cv">Tailor My CV</Button>
          <Button size="sm" variant="secondary" onClick={() => document.getElementById('s-email')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} icon={<Mail size={14} aria-hidden />}>Prepare email draft</Button>
          <CopyButton variant="secondary" size="sm" what="company details" testId="copy-company" text={() => api('v.copy.company', { id: c.id })}>Copy company details</CopyButton>
          <CopyButton variant="ghost" size="sm" what="contact information" testId="copy-contact" text={() => api('v.copy.contact', { id: c.id })}>Copy contact information</CopyButton>
          <CopyButton variant="ghost" size="sm" what="application instructions" text={() => api('v.copy.apply', { id: c.id })}>Copy how to apply</CopyButton>
          {c.website && <Button size="sm" variant="ghost" onClick={() => api('v.openExternal', { url: c.website })} icon={<Globe size={14} aria-hidden />}>Website</Button>}
          <Button size="sm" variant="ghost" onClick={() => setShowDoc(true)} disabled={!docs?.length} icon={<FileText size={14} aria-hidden />} data-testid="open-my-doc">View Resume</Button>
        </div>
      </header>

      <div className="mt-6"><MatchPanel key={profileId + c.id} profileId={profileId} companyId={c.id} role={role} onRole={setRole} /></div>
      <div className="mt-4"><ContactPanel c={cx} onChange={(n) => { setCx(n); setRecipientKey(null) }} onUseEmail={useEmail} /></div>

      {/* The three things you decide on, side by side and set apart by rules, not boxes. */}
      <div className="mt-6 grid grid-cols-[1.3fr_1fr_1fr] divide-x divide-line border-y border-line max-[1000px]:grid-cols-1 max-[1000px]:divide-x-0 max-[1000px]:divide-y" aria-label="At a glance">
        <section className="py-4 pr-6 max-[1000px]:pr-0" aria-label="Allowance summary">
          <p className="flex items-center gap-2 text-[13px] text-muted"><Mark kind={allowanceMark(a.status)} />Allowance</p>
          {amount ? <p className="figure mt-2 text-[2.6rem]" data-testid="allowance-figure"><span className="mr-1.5 font-sans text-[1.1rem] font-normal text-muted">RM</span>{amount}<span className="ml-1.5 font-sans text-[0.95rem] font-normal text-muted">per month</span></p>
            : a.status === 'CONFIRMED_UNPAID' ? <p className="font-display mt-2 text-[1.9rem] leading-tight" data-testid="allowance-figure">None paid</p>
            : a.policyRef ? <p className="mt-2" data-testid="allowance-figure"><span className="figure border-b border-dashed border-faint pb-0.5 text-[2.1rem] text-muted"><span className="mr-1 font-sans text-[1rem] font-normal">RM</span>5<span className="ml-1 font-sans text-[0.9rem] font-normal"> per hour</span></span></p>
            : <p className="font-display mt-2 text-[1.9rem] leading-tight text-muted" data-testid="allowance-figure">Not confirmed</p>}
          <p className="mt-2 text-[12.5px] leading-snug text-muted">{a.status === 'UNKNOWN' ? '' : `${ALLOWANCE_LABEL[a.status]}. `}{a.policyRef ? 'Government policy rate. A general rule, not confirmation that this organisation pays it.' : a.status === 'CONFIRMED_UNPAID' ? 'The official page says no allowance is paid.' : a.status === 'UNKNOWN' ? 'No reliable amount found. Ask before relying on one.' : a.note}</p>
        </section>
        <section className="px-5 py-4 max-[1000px]:px-0" aria-label="Internship summary">
          <p className="flex items-center gap-2 text-[13px] text-muted"><Mark kind={evidenceMark(i.evidence)} />Internship</p>
          <p className="font-display mt-2 text-[1.5rem] leading-tight">{EVIDENCE_LABEL[i.evidence]}</p>
          <p className="mt-2 text-[12.5px] leading-snug text-muted">{i.evidence === 'DIRECT_OUTREACH' || i.evidence === 'UNKNOWN' ? 'No verified opening. Write as an enquiry.' : i.method ?? 'See evidence below.'}</p>
        </section>
        <section className="py-4 pl-5 max-[1000px]:pl-0" aria-label="Contact summary">
          <p className="flex items-center gap-2 text-[13px] text-muted"><Mark kind={cs?.state === 'VERIFIED_EMAIL' ? 'verified' : cs?.state === 'GENERAL_EMAIL' ? 'probable' : cs?.state === 'NONE' ? 'none' : 'unverified'} />Contact</p>
          <p className="font-display mt-2 text-[1.5rem] leading-tight">{cs?.label ?? 'No Contact Found'}</p>
          {bestEmail ? <p className="has-reveal mt-1 flex items-center gap-1 break-all font-mono text-[13px] leading-snug">{bestEmail}<span className="reveal-copy"><CopyIcon text={bestEmail} label="best email" /></span></p> : null}
          <p className="mt-2 text-[12.5px] leading-snug text-muted">{cs?.state === 'VERIFIED_EMAIL' ? 'Independently checked recruitment address.' : cs?.state === 'GENERAL_EMAIL' ? 'General address, not HR. A fallback only.' : cs?.state === 'PORTAL' ? 'Apply through the careers portal.' : cs?.state === 'PENDING' ? 'Reported by research, not verified.' : 'See the Internship Contact section.'}</p>
        </section>
      </div>

      <Chapter id="s-company" title="Company information" note="Who they are and what they do.">
        <Fact label="Organisation" value={c.name} copy={c.name} />
        <Fact label="Website" value={c.website} copy={c.website} link={c.website} mono />
        <Fact label="Office address" value={office ? <span className="inline-flex flex-wrap items-baseline gap-x-2">{office.address}<span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-muted"><Mark kind={officeMark(office.status)} />{OFFICE_LABEL[office.status]}</span></span> : null} copy={office?.address} />
        <Fact label="Industry" value={c.industry} empty="Not recorded" />
        <Fact label="Category" value={c.categoryLabel} empty="Not recorded" />
        <Fact label="Size" value={c.size} empty="Not recorded" />
        <Fact label="Technical areas" value={c.tech.length ? c.tech.map((t: string) => TECH_LABEL[t]).join(', ') : null} empty="Not recorded" />
        <Fact label="Relevance" value={c.relevance} empty="Not recorded" />
        <Fact label="Tech division" value={c.techDivision} empty="Not recorded" />
      </Chapter>

      <Chapter id="s-internship" title="Internship" note="Research leads, not confirmed vacancies.">
        <Fact label="Evidence" value={<span className="inline-flex items-center gap-2"><Mark kind={evidenceMark(i.evidence)} />{EVIDENCE_LABEL[i.evidence]}</span>} />
        <Fact label="Possible roles" value={c.roles.length ? c.roles.join(' · ') : null} copy={c.roles.join(', ')} />
        <Fact label="Required documents" value={i.docs} copy={i.docs} />
        <Fact label="Deadline" value={i.deadline && !/^rolling$/i.test(i.deadline) ? i.deadline : null} copy={i.deadline} />
        <Fact label="How to apply" value={i.method} copy={i.method} />
        <Fact label="Application page" value={i.applicationUrl} copy={i.applicationUrl} link={i.applicationUrl} mono />
        {i.auditNote && <Fact label="Audit note" value={i.auditNote} />}
      </Chapter>

      <Chapter id="s-allowance" title="Allowance" note="Only evidence decides what is shown.">
        <Fact label="Status" value={<span className="inline-flex items-center gap-2"><Mark kind={allowanceMark(a.status)} />{ALLOWANCE_LABEL[a.status]}</span>} />
        {amount && <Fact label="Amount" value={`RM${amount} per month`} copy={`RM${amount} per month`} />}
        {a.policyRef && <Fact label="Government policy" value={<span>JPA pays RM5 per hour, up to 8 hours a day and 90 paid days. This is a general rule, not confirmation that this organisation pays it.</span>} />}
        {a.claimText && a.status !== 'CONFIRMED_PAID' && <Fact label="Unverified claim" value={<span className="text-muted">{a.claimText}</span>} />}
        <Fact label="Conditions" value={a.conditions} />
        <Fact label="Other benefits" value={a.benefits} />
        <Fact label="Source" value={a.sourceUrl} copy={a.sourceUrl} link={a.sourceUrl} mono />
        <Fact label="Source date" value={a.sourceDate} />
        <div className="pt-3"><CopyButton size="sm" variant="ghost" what="allowance information" text={() => api('v.copy.allowance', { id: c.id })}>Copy allowance info</CopyButton></div>
      </Chapter>

      <Chapter id="s-contact" title="Earlier contact research" note="From the first research file. Not verified. The Internship Contact section above is the current view.">
        <Fact label="HR email" value={k.hrEmail} copy={k.hrEmail} mono />
        <Fact label="General email" value={k.generalEmail} copy={k.generalEmail} mono />
        <Fact label="Phone" value={k.phone} copy={k.phone} mono />
        <Fact label="Careers page" value={k.careersUrl} copy={k.careersUrl} link={k.careersUrl} mono />
        <Fact label="Contact form" value={k.contactForm} />
        <Fact label="LinkedIn" value={k.linkedin} copy={k.linkedin} link={k.linkedin} mono />
      </Chapter>

      <Chapter id="s-evidence" title="Research evidence" note="What the claims rest on.">
        <Fact label="Last verified" value={c.lastVerified} />
        {c.uncertainties.length > 0 && <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 border-b border-line/70 py-2 text-sm"><dt className="text-[13px] text-muted">Check before relying</dt><dd><ul className="space-y-1">{c.uncertainties.map((u: string) => <li key={u} className="flex items-baseline gap-2"><Mark kind="unverified" className="translate-y-px" />{u}</li>)}</ul></dd></div>}
        {c.sources.length > 0 ? <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 border-b border-line/70 py-2 text-sm"><dt className="text-[13px] text-muted">Sources</dt><dd><ul className="space-y-1">{c.sources.map((s: any, n: number) => <li key={n} className="has-reveal flex items-center gap-1.5">{s.url ? <button className="truncate text-left text-primary underline-offset-2 hover:underline" onClick={() => api('v.openExternal', { url: s.url })}>{s.label}</button> : <span>{s.label}</span>}{s.url && <span className="reveal-copy"><CopyIcon text={s.url} label="source link" /></span>}</li>)}</ul></dd></div> : <Fact label="Sources" value={null} />}
        <Fact label="Notes" value={c.notes} empty="Not recorded" />
        <Fact label="Suggested next step" value={c.nextAction} empty="Not recorded" />
      </Chapter>

      <section className="grid grid-cols-[10.5rem_minmax(0,1fr)] gap-x-8 border-t border-line pt-5 max-[1100px]:grid-cols-1 max-[1100px]:gap-y-2" aria-labelledby="s-email">
        <div><h3 id="s-email" className="text-[15px] font-semibold">Email draft for {profile.displayName}</h3><p className="mt-1 text-[12.5px] leading-snug text-muted">Copy and paste. Nothing is sent from here.</p></div>
        <EmailDraft company={cx} role={role} recipientKey={recipientKey} onRecipient={setRecipientKey} />
      </section>

      {studio && role && <CvStudio company={c} role={role} roles={ROLE_OPTIONS} onClose={() => setStudio(false)} />}
      {showDoc && docs && <Modal wide title={`${profile.displayName}’s documents`} onClose={() => setShowDoc(false)}><DocViewer profileId={profileId} docs={docs} /></Modal>}
      {docs && !docs.length && <p className="mt-5 border-l-2 border-line-strong pl-3 text-[13px] text-muted">No resume linked for {profile.displayName}. Add one in My Resumes if you want it here. It is optional.</p>}
    </article>
  )
}
