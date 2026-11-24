import { useEffect, useState } from 'react'
import { Scale } from 'lucide-react'
import { api, errMsg } from './api'
import { Banner, Chip, Modal, Select, Spinner, cx } from './ui'

const PRIORITIES = [['balanced', 'Balanced'], ['learning', 'Best technical learning'], ['allowance', 'Highest verified allowance'], ['swe', 'Software engineering relevance'], ['cyber', 'Cybersecurity relevance'], ['contact', 'Contact accessibility'], ['opening', 'Current opening availability']] as const
const rm = (n: number) => n.toLocaleString('en-MY', { maximumFractionDigits: 0 })

export function CompareModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [priority, setPriority] = useState<string>('balanced')
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => { let a = true; setData(null); api('companies.compare', { ids, priority }).then((d) => a && setData(d)).catch((e) => a && setErr(errMsg(e))); return () => { a = false } }, [ids.join(','), priority])
  const row = (label: string, f: (c: any) => React.ReactNode) => <tr className="border-t border-line"><th scope="row" className="w-40 py-2.5 pr-3 text-left align-top text-xs font-medium text-muted">{label}</th>{data.companies.map((c: any) => <td key={c.company_id} className="py-2.5 pr-3 align-top text-sm">{f(c)}</td>)}</tr>
  return (
    <Modal wide title="Compare employers" onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">Priority
          <Select aria-label="Comparison priority" className="mt-1 w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
        <p className="min-w-0 flex-1 text-xs text-muted">Scores describe how well the <em>recorded evidence</em> matches your priority. They are not a prediction of hiring success.</p>
      </div>
      {err && <Banner tone="bad" title="Could not compare">{err}</Banner>}
      {!data && !err && <Spinner label="Comparing" />}
      {data && <>
        <Banner tone={data.winnerId ? 'ok' : 'neutral'} title={data.winnerId ? 'Closest match for this priority' : 'No clear winner'}>{data.reason}</Banner>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead><tr><th className="w-40" /> {data.companies.map((c: any, i: number) => { const s = data.scored[i]; return (
              <th key={c.company_id} scope="col" className={cx('pb-3 pr-3 text-left align-bottom', data.winnerId === c.company_id && 'text-primary')}>
                <span className="font-display block text-xl leading-tight">{c.name}</span>
                <span className="mt-1 flex items-center gap-1.5 text-xs font-normal text-muted">{s.score == null ? <Chip>Score withheld — not enough evidence</Chip> : <><span className="num-display text-base text-ink">{s.score}</span>/100 on this priority</>}</span>
              </th>) })}</tr></thead>
            <tbody>
              {row('Location', (c) => c.cities.join(' + ') || '—')}
              {row('Sector', (c) => c.sector_group === 'GOVERNMENT' ? 'Government' : c.sector_group === 'NON_GOVERNMENT' ? 'Non-government' : 'Unclassified')}
              {row('Ownership / size', (c) => <>{c.classes.map((k: string) => k.replace(/_/g, ' ').toLowerCase()).join(', ') || '—'}<span className="block text-xs text-muted">{c.company_size ?? ''}</span></>)}
              {row('Internship evidence', (c) => c.internship_evidence.replace(/_/g, ' ').toLowerCase())}
              {row('Technical areas', (c) => c.role_families.filter((r: string) => r !== 'other').join(', ') || '—')}
              {row('Allowance', (c) => c.allowance.monthly ? <span><span className="num-display text-base">RM{rm(c.allowance.monthly.min)}{c.allowance.monthly.max !== c.allowance.monthly.min ? `–${rm(c.allowance.monthly.max)}` : ''}</span> <span className="text-xs text-muted">{c.allowance.grade} {c.allowance.label}</span></span> : <span className="text-muted">{c.allowance.unpaid ? 'Unpaid per official page' : 'Not confirmed'}</span>)}
              {row('Contact', (c) => c.hr_email || (/@/.test(c.general_contact ?? '') ? c.general_contact : c.careers_page ? 'Careers page' : c.general_contact || '—'))}
              {row('Application route', (c) => c.recommended_method ?? '—')}
              {row('Deadline', (c) => c.deadline_text ?? 'Not recorded')}
              {row('Evidence checked', (c) => c.last_verified ?? 'Never')}
              {row('Your fit', (c) => c.fit?.status === 'scored' ? `${c.fit.label}` : '—')}
            </tbody>
          </table>
        </div>
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium"><Scale size={14} className="mr-1 inline" aria-hidden />How these scores were calculated</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">{data.scored.map((s: any) => <div key={s.company_id}><p className="font-medium">{s.name}</p><ul className="mt-1 space-y-0.5 text-xs text-muted">{s.criteria.map((k: any) => <li key={k.key}>{k.label}: <span className="text-ink">{k.value == null ? 'unknown (not counted)' : `${Math.round(k.value * 100)}%`}</span> — {k.note}</li>)}</ul></div>)}</div>
        </details>
      </>}
    </Modal>
  )
}
