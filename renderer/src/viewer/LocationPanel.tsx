import { useState } from 'react'
import { MapPin, ShieldAlert, ShieldCheck } from 'lucide-react'
import { api, errMsg } from '../api'
import { Banner, Button, Chip, Select, cx, useToast } from '../ui'
import { CopyIcon } from './Copy'

export const LOCATION_TONE: Record<string, 'ok' | 'info' | 'neutral' | 'warn' | 'bad'> = {
  VERIFIED_TARGET_OFFICE: 'ok', VERIFIED_NEARBY_OFFICE: 'info', PROVISIONAL_LOCAL_OFFICE: 'warn', UNVERIFIED_LOCATION: 'neutral', OUTSIDE_TARGET_AREA: 'neutral', DISPUTED_LOCATION: 'bad',
}
const STATUSES: [string, string][] = [['VERIFIED_TARGET_OFFICE', 'Verified office (Cyberjaya or Putrajaya)'], ['VERIFIED_NEARBY_OFFICE', 'Verified nearby office (IOI Resort City)'], ['PROVISIONAL_LOCAL_OFFICE', 'Provisional, not verified'], ['UNVERIFIED_LOCATION', 'Location not verified'], ['OUTSIDE_TARGET_AREA', 'Outside target area'], ['DISPUTED_LOCATION', 'Location disputed']]
const ZONES: [string, string][] = [['CYBERJAYA', 'Cyberjaya'], ['PUTRAJAYA', 'Putrajaya'], ['IOI_RESORT_CITY', 'IOI Resort City'], ['OUTSIDE', 'Outside target area'], ['UNKNOWN', 'Unknown']]
const OFFICE_TYPES: [string, string][] = [['BRANCH_OFFICE', 'Branch office'], ['HEADQUARTERS', 'Headquarters'], ['OPERATIONAL_SITE', 'Operational site'], ['CAMPUS', 'Campus'], ['DATA_CENTRE', 'Data centre'], ['UNKNOWN', 'Not stated']]
const FLAG: Record<string, string> = {
  RESEARCH_SAYS_NOT_SUPPORTED: 'The research itself says a local office is not supported.', PROJECT_OR_CLIENT_SITE_WORDING: 'Described as a project or client site, which is not an office.', HQ_ELSEWHERE_STATED: 'Headquarters is stated to be elsewhere.',
  MERGED_RECORD_HAD_DIFFERENT_CITY: 'An earlier record for this organisation claimed a different city.', IOI_ADDRESS_UNDER_PUTRAJAYA_CLAIM: 'An IOI Resort City address was filed under Putrajaya.', PUTRAJAYA_POSTCODE_WITHOUT_PRECINCT: 'Only a Putrajaya postcode is given. A postcode does not prove the site is in the Federal Territory.',
  PROBABLE_ONLY_PENDING_SUITE: 'Office only rated probable, suite unconfirmed.', ALL_OFFICES_UNVERIFIED: 'Every recorded address is unverified.', NO_OFFICE_ADDRESS: 'No address recorded.',
}
const CHECK_LABEL: Record<string, string> = { SUPPORTED: 'names the employer, the zone and the address', ZONE_ONLY: 'shows the employer in this zone, not the building', PARTIAL: 'only part of the claim found', UNSUPPORTED: 'does not support the claim', UNREACHABLE: 'could not be opened or read', NOT_CHECKED: 'not checked' }
const field = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm placeholder:text-faint focus-visible:border-primary'

/** Where the organisation really is, and separately where interns sit. A technical match never changes anything here. */
export function LocationPanel({ c }: { c: any }) {
  const toast = useToast()
  const [info, setInfo] = useState(c.locationInfo)
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ status: 'VERIFIED_TARGET_OFFICE', zone: 'CYBERJAYA', address: '', officeType: 'BRANCH_OFFICE', sourceUrl: '', sourceDate: '', note: '' })
  const verified = info.verified
  const flags: string[] = (info.flags ?? []).filter((x: string) => FLAG[x])
  const Icon = verified ? ShieldCheck : ShieldAlert
  const save = async (body: any, ok: string) => { try { setInfo(await api('v.location.confirm', { companyId: c.id, ...body })); toast('ok', ok); setEdit(false) } catch (e) { toast('bad', errMsg(e)) } }
  return (
    <section aria-label="Physical location" className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)]" data-testid="location-panel" data-status={info.physical_office_status}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-[15px] font-bold">Physical location</h3>
        <Chip tone={LOCATION_TONE[info.physical_office_status]} icon={<Icon size={12} aria-hidden />} className="text-[12.5px]"><span data-testid="location-label">{info.statusLabel}</span></Chip>
        {info.physical_office_zone !== 'UNKNOWN' && <Chip tone="neutral" icon={<MapPin size={12} aria-hidden />} className="text-[12.5px]">{info.zoneLabel}</Chip>}
        {info.origin === 'USER_CONFIRMED' && <Chip tone="info" className="text-[12.5px]">Confirmed by you</Chip>}
      </div>
      {!verified && <div className="mt-3"><Banner tone={info.physical_office_status === 'OUTSIDE_TARGET_AREA' ? 'info' : 'warn'} title={info.physical_office_status === 'OUTSIDE_TARGET_AREA' ? 'Known offices are outside the target area' : 'Do not assume this is a Cyberjaya or Putrajaya workplace'}>
        {info.claimedCity ? `Earlier research listed ${info.claimedCity}. That was a claim, and it has not been checked against a current, location-specific source.` : 'No location has been verified.'}</Banner></div>}
      <dl className="mt-3 text-sm">
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 border-b border-line/70 py-2"><dt className="text-[13px] text-muted">Office address</dt><dd className="has-reveal break-words">{info.physical_office_address ?? <span className="text-faint">Not recorded</span>}{info.physical_office_address && <span className="reveal-copy ml-1"><CopyIcon text={info.physical_office_address} label="office address" /></span>}</dd></div>
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 border-b border-line/70 py-2"><dt className="text-[13px] text-muted">Kind of site</dt><dd>{info.office_type === 'UNKNOWN' ? <span className="text-faint">Not established</span> : info.office_type.replace(/_/g, ' ').toLowerCase()}</dd></div>
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 border-b border-line/70 py-2"><dt className="text-[13px] text-muted">Evidence</dt><dd>{info.office_source_url ? <button className="underline decoration-dotted underline-offset-2" onClick={() => api('v.openExternal', { url: info.office_source_url })}>Source{info.office_source_date ? `, dated ${info.office_source_date}` : ''}</button> : <span className="text-faint">No location-specific source</span>}{info.office_last_checked && <span className="ml-2 text-[12.5px] text-muted">checked {info.office_last_checked}</span>}{info.office_source_check && <span className="block text-[12.5px] text-muted" data-testid="source-check">Page read: {CHECK_LABEL[info.office_source_check] ?? info.office_source_check}</span>}</dd></div>
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 py-2"><dt className="text-[13px] text-muted">Internship placement</dt><dd data-testid="placement-line"><span className={cx('font-semibold', info.placement === 'VERIFIED_LOCAL' ? 'text-ok' : '')}>{info.placementLabel}.</span> <span className="text-muted">{info.placementLine}</span></dd></div>
      </dl>
      {((info.evidence_flags ?? []).length > 0 || flags.length > 0 || info.location_review_notes) && <details className="mt-1 text-[12.5px] text-muted"><summary className="cursor-pointer font-semibold">Why this status</summary>
        {(info.evidence_flags ?? []).length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-5" data-testid="evidence-flags">{info.evidence_flags.map((x: string) => <li key={x}>{x}</li>)}</ul>}
        {flags.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{flags.map((x) => <li key={x}>{FLAG[x]}</li>)}</ul>}
        {info.location_review_notes && <p className="mt-1.5 leading-snug">{info.location_review_notes}</p>}</details>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setEdit(!edit)} aria-expanded={edit} data-testid="location-correct">{edit ? 'Cancel' : 'Record a correction'}</Button>
        {info.origin === 'USER_CONFIRMED' && <Button size="sm" variant="ghost" onClick={() => save({ clear: true }, 'Your correction was removed.')}>Remove my correction</Button>}
      </div>
      {edit && (
        <form className="mt-3 grid gap-3 rounded-xl border border-line p-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(f, 'Location saved.') }} data-testid="location-form">
          <label className="text-[12.5px] font-semibold">Status<Select className="mt-1 h-9 text-[13px]" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
          <label className="text-[12.5px] font-semibold">Zone<Select className="mt-1 h-9 text-[13px]" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}>{ZONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
          <label className="text-[12.5px] font-semibold md:col-span-2">Office address<input className={cx(field, 'mt-1')} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          <label className="text-[12.5px] font-semibold">Kind of site<Select className="mt-1 h-9 text-[13px]" value={f.officeType} onChange={(e) => setF({ ...f, officeType: e.target.value })}>{OFFICE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
          <label className="text-[12.5px] font-semibold">Source date<input type="date" className={cx(field, 'mt-1')} value={f.sourceDate} onChange={(e) => setF({ ...f, sourceDate: e.target.value })} /></label>
          <label className="text-[12.5px] font-semibold md:col-span-2">Source link<input className={cx(field, 'mt-1')} value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} placeholder="https://" /></label>
          <label className="text-[12.5px] font-semibold md:col-span-2">Note<input className={cx(field, 'mt-1')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <div className="md:col-span-2"><Button size="sm" variant="primary" type="submit">Save my correction</Button><span className="ml-3 text-[12px] text-muted">A verified office needs an address, a source link and its date. Your correction is kept when an audit file is imported.</span></div>
        </form>)}
    </section>
  )
}
