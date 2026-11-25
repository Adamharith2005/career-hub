import { useState } from 'react'
import { BadgeCheck, ClipboardList, ExternalLink, Globe, Mail, Phone, Search, ShieldAlert, TriangleAlert } from 'lucide-react'
import { api, errMsg } from '../api'
import { Banner, Button, Chip, cx, useToast } from '../ui'
import { CopyButton, CopyIcon } from './Copy'
import { CONTACT_TONE, TIER_LABEL, VERIFICATION_LABEL, verificationTone } from './labels'

const ICON = { EMAIL: Mail, PORTAL: Globe, PHONE_FORM: Phone } as const
const isCurrent = (v: string) => v === 'CHECKED_CURRENT' || v === 'USER_CONFIRMED'

/** The Internship Contact section: the best route first, the evidence behind it, and every alternative. Labels never promise more than the evidence shows. */
export function ContactPanel({ c, onChange, onUseEmail }: { c: any; onChange: (c: any) => void; onUseEmail: (key: string) => void }) {
  const toast = useToast()
  const s = c.contactSummary
  const intel = c.contactIntel
  const [showEvidence, setShowEvidence] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const best = s.best
  const open = (url: string) => api('v.openExternal', { url }).catch((e) => toast('bad', errMsg(e)))
  const act = async (name: string, args: any, ok: string) => { try { onChange(await api(name, args)); toast('ok', ok) } catch (e) { toast('bad', errMsg(e)) } }
  const verified = best && isCurrent(best.verification)
  const dept = best?.department ?? intel?.reportedDepartment
  const evidenceCount = intel?.evidence?.length ?? 0
  const Icon = best ? ICON[best.kind as keyof typeof ICON] : ShieldAlert

  return (
    <section aria-label="Internship contact" className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)]" data-testid="contact-panel" data-state={s.state}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-[15px] font-bold">Internship Contact</h3>
        <Chip tone={CONTACT_TONE[s.state]} icon={<Icon size={12} aria-hidden />} className="text-[12.5px]"><span data-testid="contact-label">{s.label}</span></Chip>
        {best && <Chip tone={verificationTone(best.verification)} icon={/^(CHECKED_CURRENT|CHECKED_GENERAL|USER_CONFIRMED)$/.test(best.verification) ? <BadgeCheck size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />} className="text-[12.5px]"><span data-testid="contact-verification">{VERIFICATION_LABEL[best.verification]}</span></Chip>}
        {s.needsResearch && <Chip tone="info" className="text-[12.5px]">Marked for research</Chip>}
      </div>

      {/* Best available route */}
      <div className="mt-4">
        {best ? (
          <div>
            <p className="text-[12.5px] text-muted">{TIER_LABEL[best.tier as keyof typeof TIER_LABEL]} · {best.label}</p>
            {best.kind === 'EMAIL' ? <p className="has-reveal mt-1 flex flex-wrap items-center gap-1 break-all font-mono text-[17px] leading-snug" data-testid="contact-best">{best.value}<span className="reveal-copy"><CopyIcon text={best.value} label="best contact email" /></span></p>
              : best.kind === 'PORTAL' ? <button className="mt-1 break-all text-left font-mono text-[14px] text-primary hover:underline" onClick={() => open(best.value)} data-testid="contact-best">{best.value.replace(/^https?:\/\/(www\.)?/, '')}</button>
              : <p className="mt-1 break-all font-mono text-[15px]" data-testid="contact-best">{best.value}</p>}
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
              <div><dt className="text-muted">Reported department (from the research report)</dt><dd className="font-medium">{dept ?? 'Not recorded'}</dd></div>
              <div><dt className="text-muted">Last researched</dt><dd className="font-medium">{best.checkedOn ? `${best.checkedOn}, independently checked` : intel?.researchedOn ? `${intel.researchedOn}, not independently checked` : 'Not dated'}</dd></div>
              {best.sourceUrl && <div><dt className="text-muted">Source</dt><dd><button className="inline-flex items-center gap-1 break-all text-left text-primary hover:underline" onClick={() => open(best.sourceUrl)} data-testid="contact-source"><ExternalLink size={12} aria-hidden />{best.sourceUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</button></dd></div>}
              {intel?.nextStep && <div className="sm:col-span-2"><dt className="text-muted">Recommended next step</dt><dd className="font-medium">{intel.nextStep}</dd></div>}
            </dl>
            {best.note && best.note !== intel?.auditNote && <p className="mt-2 text-[12.5px] leading-snug text-muted">{best.note}</p>}
          </div>
        ) : <p className="text-[14px] text-muted" data-testid="contact-best">No reliable contact route has been found for this organisation.{intel?.nextStep ? ` ${intel.nextStep}` : ''}</p>}
        {s.warnings.map((w: string) => <p key={w} className="mt-2 flex gap-1.5 rounded-md bg-warn-bg px-3 py-1.5 text-[12.5px] text-warn" data-testid="contact-warning"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{w}</p>)}
        {intel?.auditNote && <p className="mt-2 text-[12.5px] leading-snug text-muted"><span className="font-semibold text-ink">Research note:</span> {intel.auditNote}</p>}
        <p className="mt-2 text-[12px] text-muted">A contact is not a vacancy. Career Hub has not verified a current internship opening here.</p>
      </div>

      {/* Actions that match what the evidence supports */}
      <div className="mt-4 flex flex-wrap items-center gap-1" data-testid="contact-actions">
        {s.state === 'VERIFIED_EMAIL' && <><CopyButton variant="primary" size="sm" text={best.value} what="email" testId="contact-copy">Copy Email</CopyButton><Button size="sm" variant="secondary" onClick={() => onUseEmail(best.key)} icon={<Mail size={14} aria-hidden />}>Prepare Email</Button>{best.sourceUrl && <Button size="sm" variant="ghost" onClick={() => open(best.sourceUrl)} icon={<ExternalLink size={14} aria-hidden />}>View Official Source</Button>}</>}
        {s.state === 'GENERAL_EMAIL' && <><CopyButton variant="primary" size="sm" text={best.value} what="general email" testId="contact-copy">Copy General Email</CopyButton><Button size="sm" variant="secondary" onClick={() => onUseEmail(best.key)} icon={<Mail size={14} aria-hidden />}>Prepare General Enquiry</Button>{best.sourceUrl && <Button size="sm" variant="ghost" onClick={() => open(best.sourceUrl)} icon={<ExternalLink size={14} aria-hidden />}>View Source</Button>}</>}
        {s.state === 'PORTAL' && <><Button size="sm" variant="primary" onClick={() => open(best.value)} icon={<Globe size={14} aria-hidden />} data-testid="contact-open-portal">Open Careers Portal</Button><Button size="sm" variant="secondary" onClick={() => setShowInstructions(!showInstructions)} aria-expanded={showInstructions} icon={<ClipboardList size={14} aria-hidden />}>View Application Instructions</Button></>}
        {s.state === 'PENDING' && <>{best?.sourceUrl && <Button size="sm" variant="secondary" onClick={() => open(best.sourceUrl)} icon={<ExternalLink size={14} aria-hidden />}>View Research Lead</Button>}{best?.kind === 'PORTAL' && <Button size="sm" variant="secondary" onClick={() => open(best.value)} icon={<ExternalLink size={14} aria-hidden />}>View Research Lead</Button>}
          <Button size="sm" variant="ghost" onClick={() => setShowEvidence(true)} icon={<Search size={14} aria-hidden />} data-testid="contact-view-evidence">View Evidence</Button>
          {best?.kind === 'EMAIL' && <Button size="sm" variant="ghost" onClick={() => onUseEmail(best.key)} icon={<Mail size={14} aria-hidden />} data-testid="contact-use-anyway">Use in email anyway</Button>}</>}
        {s.state === 'NONE' && <>{c.website && <Button size="sm" variant="primary" onClick={() => open(c.website)} icon={<Globe size={14} aria-hidden />}>Open Official Website</Button>}<CopyButton variant="secondary" size="sm" text={c.name} what="company name">Copy Company Name</CopyButton>
          <Button size="sm" variant="ghost" onClick={() => setShowEvidence(true)} icon={<Search size={14} aria-hidden />}>View Existing Research</Button></>}
        <Button size="sm" variant="ghost" aria-pressed={s.needsResearch} onClick={() => act('v.contacts.research', { companyId: c.id, on: !s.needsResearch }, s.needsResearch ? 'Research flag removed.' : 'Marked for research.')} data-testid="contact-mark">{s.needsResearch ? 'Remove research mark' : 'Mark for Research'}</Button>
      </div>
      {showInstructions && <div className="anim-fade-up mt-3 rounded-md border border-line p-3 text-[13px]" data-testid="contact-instructions"><p className="font-semibold">How to apply</p><p className="mt-1 text-muted">{intel?.nextStep ?? 'Use the careers portal.'}</p>{c.internship.docs && <p className="mt-1">Documents: {c.internship.docs}</p>}<p className="mt-1 text-muted">Apply only for a relevant vacancy you can see on the portal.</p></div>}

      {/* Alternatives */}
      {s.routes.length > 1 && (
        <div className="mt-5 border-t border-line pt-4" data-testid="contact-alternatives">
          <h4 className="mb-2 text-[13px] font-bold">Other researched routes</h4>
          <ul className="space-y-2">{s.routes.filter((r: any) => r.key !== best?.key).map((r: any) => { const I = ICON[r.kind as keyof typeof ICON]; return (
            <li key={r.key} className="has-reveal flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <I size={14} className="shrink-0 text-muted" aria-hidden /><span className="min-w-0 break-all font-mono text-[12.5px]">{r.value.replace(/^https?:\/\/(www\.)?/, '')}</span>
              <Chip tone={verificationTone(r.verification)} className="text-[11.5px]">{VERIFICATION_LABEL[r.verification as keyof typeof VERIFICATION_LABEL]}</Chip><span className="text-[12px] text-muted">{TIER_LABEL[r.tier as keyof typeof TIER_LABEL]}</span>
              <span className="reveal-copy ml-auto flex items-center gap-1">
                <CopyIcon text={r.value} label={r.kind === 'EMAIL' ? 'email' : 'link'} />
                {r.kind !== 'EMAIL' && /^https?:/.test(r.value) && <button aria-label="Open link" className="press grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-surface2 hover:text-ink" onClick={() => open(r.value)}><ExternalLink size={14} aria-hidden /></button>}
                {r.kind === 'EMAIL' && r.verification !== 'INVALID' && <Button size="sm" variant="ghost" onClick={() => onUseEmail(r.key)}>Use in email</Button>}
              </span></li>) })}</ul>
        </div>)}

      {/* Evidence */}
      <details className="mt-4 text-[13px]" open={showEvidence} onToggle={(e) => setShowEvidence((e.target as HTMLDetailsElement).open)} data-testid="contact-evidence">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-muted">Evidence behind this ({evidenceCount})</summary>
        {evidenceCount === 0 ? <p className="mt-2 text-muted">No contact evidence is recorded for this organisation. Earlier research is shown in the sections below.</p> : (
          <ul className="mt-2 space-y-2">{intel.evidence.map((e: any, i: number) => (
            <li key={i} className={cx('rounded-md border border-line px-3 py-2', e.inspected && 'border-primary/40')}>
              <p className="font-semibold">{e.inspected ? 'Independent check' : 'Gemini research report'}{e.date ? ` · ${e.date}` : ''}</p>
              <p className="text-[12.5px] text-muted">{e.purpose}{e.tierClaimed || e.tierAudited ? ` · claimed ${e.tierClaimed || 'n/a'}, audited ${e.tierAudited || 'n/a'}` : ''}</p>
              {(e.emailClaimed || e.emailIndependent) && <p className="font-mono text-[12.5px]">{e.inspected && e.emailIndependent ? `Checked: ${e.emailIndependent}` : e.emailClaimed ? `Claimed: ${e.emailClaimed}` : null}</p>}
              {e.note && <p className="mt-0.5 text-[12.5px]">{e.note}</p>}
              {e.sourceUrl && <button className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline" onClick={() => open(e.sourceUrl)}><ExternalLink size={11} aria-hidden />{e.sourceUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</button>}
            </li>))}</ul>)}
        <p className="mt-2 text-[12px] text-muted">Source file: {intel?.source ?? 'none'}. Independently checked means a person inspected the source. Gemini-reported contacts have not been inspected.</p>
      </details>
      {best && !verified && s.state !== 'NONE' && best.kind === 'EMAIL' && best.verification !== 'CHECKED_GENERAL' && (
        <div className="mt-3"><Button size="sm" variant="ghost" onClick={() => act('v.contacts.confirm', { companyId: c.id, key: best.key }, 'Saved as confirmed by you.')} data-testid="contact-confirm">I have checked this address myself</Button></div>)}
      {best?.verification === 'USER_CONFIRMED' && <div className="mt-3"><Banner tone="ok" title="Confirmed by you">This address is marked as confirmed in Career Hub. <button className="underline" onClick={() => act('v.contacts.confirm', { companyId: c.id, key: best.key, on: false }, 'Confirmation removed.')}>Remove confirmation</button></Banner></div>}
    </section>
  )
}
