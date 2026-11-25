import { useEffect, useState } from 'react'
import { api, errMsg } from '../api'
import { Banner, Chip, Modal, Select, Spinner, cx } from '../ui'
import { ALLOWANCE_LABEL, EVIDENCE_LABEL, TECH_LABEL } from './labels'

const PRIORITIES = [['balanced', 'Balanced'], ['learning', 'Technical breadth'], ['allowance', 'Verified allowance'], ['swe', 'Software engineering'], ['cyber', 'Cybersecurity'], ['contact', 'Contact accessibility'], ['opening', 'Opening availability']] as const

export function CompareModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [priority, setPriority] = useState('balanced')
  const [data, setData] = useState<any>(null)
  const [cos, setCos] = useState<any[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true; setData(null); setErr('')
    Promise.all([api('v.companies.compare', { ids, priority }), Promise.all(ids.map((id) => api('v.companies.get', { id })))]).then(([d, c]) => { if (live) { setData(d); setCos(c) } }).catch((e) => live && setErr(errMsg(e)))
    return () => { live = false }
  }, [ids.join(','), priority])  // eslint-disable-line react-hooks/exhaustive-deps
  const row = (label: string, f: (c: any) => React.ReactNode) => <tr className="border-t border-line"><th scope="row" className="w-36 py-2.5 pr-3 text-left align-top text-xs font-medium text-muted">{label}</th>{cos.map((c) => <td key={c.id} className="py-2.5 pr-3 align-top text-sm">{f(c)}</td>)}</tr>
  return (
    <Modal wide title="Compare organisations" onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">Priority<Select aria-label="Comparison priority" className="mt-1 w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
        <p className="min-w-0 flex-1 text-xs text-muted">Scores show how well the <em>recorded evidence</em> matches the priority. Unknown is never counted as zero, and the score is not a prediction of being hired.</p>
      </div>
      {err && <Banner tone="bad" title="Could not compare">{err}</Banner>}
      {!data && !err && <Spinner label="Comparing" />}
      {data && cos.length === data.scored.length && <div className="anim-fade-up">
        <Banner tone={data.winnerId ? 'ok' : 'neutral'} title={data.winnerId ? 'Closest match for this priority' : 'No clear winner'}>{data.reason}</Banner>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse">
            <thead><tr><th className="w-36" />{cos.map((c, i) => { const s = data.scored[i]; return (
              <th key={c.id} scope="col" className={cx('pb-3 pr-3 text-left align-bottom', data.winnerId === c.id && 'text-primary')}>
                <span className="block text-base font-semibold leading-tight">{c.name}</span>
                <span className="mt-1 flex items-center gap-1.5 text-xs font-normal text-muted">{s.score == null ? <Chip>Score withheld · not enough evidence</Chip> : <><span className="num-display text-base text-ink">{s.score}</span>/100</>}</span>
              </th>) })}</tr></thead>
            <tbody>
              {row('Location', (c) => c.city ?? '—')}
              {row('Sector', (c) => c.sector === 'GOVERNMENT' ? 'Government' : c.sector === 'NON_GOVERNMENT' ? 'Non-government' : 'Unclassified')}
              {row('Technical areas', (c) => c.tech.map((t: string) => TECH_LABEL[t]).join(', ') || '—')}
              {row('Internship evidence', (c) => EVIDENCE_LABEL[c.internship.evidence])}
              {row('Allowance', (c) => <span className={c.allowance.status === 'UNKNOWN' ? 'text-muted' : ''}>{ALLOWANCE_LABEL[c.allowance.status]}{c.allowance.monthlyMin != null && ` · RM${c.allowance.monthlyMin}`}</span>)}
              {row('Contact', (c) => c.contacts.hrEmail || c.contacts.generalEmail || (c.contacts.careersUrl ? 'Careers page' : '—'))}
              {row('Evidence checked', (c) => c.lastVerified ?? 'Not recorded')}
            </tbody>
          </table>
        </div>
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">How the scores were calculated</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">{data.scored.map((s: any) => <div key={s.company_id}><p className="font-medium">{s.name}</p><ul className="mt-1 space-y-0.5 text-xs text-muted">{s.criteria.map((k: any) => <li key={k.key}>{k.label}: <span className="text-ink">{k.value == null ? 'unknown (not counted)' : `${Math.round(k.value * 100)}%`}</span> · {k.note}</li>)}</ul></div>)}</div>
        </details></div>}
    </Modal>
  )
}
