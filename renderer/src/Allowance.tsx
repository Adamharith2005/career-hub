import { useState } from 'react'
import { ExternalLink, HelpCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api, errMsg, fmtDate } from './api'
import { Button, Chip, cx, useToast } from './ui'

const TONE: Record<string, 'ok' | 'info' | 'warn' | 'neutral' | 'bad'> = { A1: 'ok', A2: 'info', A3: 'warn', A4: 'warn', A5: 'neutral', A6: 'bad' }
const rm = (n: number) => n.toLocaleString('en-MY', { maximumFractionDigits: 0 })

/** Evidence-first allowance card. Unknown is shown as "not confirmed" — never as RM0. */
export function AllowanceCard({ a, onAsk }: { a: any; onAsk?: () => void }) {
  const toast = useToast()
  const [days, setDays] = useState(20)
  const [ill, setIll] = useState<any>(null)
  const open = (url: string) => api('link.open', { url }).catch((e) => toast('bad', errMsg(e)))
  if (!a) return null
  const stale = a.staleDays != null && a.staleDays > 365
  return (
    <section aria-labelledby="allow-h" className="card-soft p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 id="allow-h" className="eyebrow">Allowance</h3>
        <Chip tone={TONE[a.grade]} icon={a.gradeKnown ? <ShieldCheck size={11} aria-hidden /> : <HelpCircle size={11} aria-hidden />}>{a.grade} · {a.label}</Chip>
      </div>
      {a.monthly ? (
        <p className="mt-2 flex items-baseline gap-1.5">
          <span className="text-sm text-muted">RM</span>
          <span className="num-display text-[34px] font-medium leading-none">{rm(a.monthly.min)}{a.monthly.max !== a.monthly.min ? `–${rm(a.monthly.max)}` : ''}</span>
          <span className="text-sm text-muted">per month</span>
        </p>
      ) : a.unpaid ? (
        <p className="mt-2 text-lg font-medium">Official page says: no allowance</p>
      ) : (
        <p className="mt-2 text-lg font-medium">Allowance not confirmed</p>
      )}
      {(a.verifiedAt || a.sourceDate) && <p className={cx('mt-1 flex items-center gap-1 text-xs', stale ? 'text-warn' : 'text-muted')}>{stale && <TriangleAlert size={12} aria-hidden />}Evidence from {fmtDate(a.verifiedAt ?? a.sourceDate)}{a.staleDays != null && ` (${a.staleDays} days ago)`}</p>}
      {a.note && <p className="mt-2 text-sm text-muted">{a.note}</p>}
      {a.claimText && !a.monthly && <p className="mt-2 rounded-md border border-dashed border-line-strong px-2.5 py-1.5 text-xs text-muted"><strong className="font-medium text-ink">Unverified spreadsheet claim:</strong> {a.claimText}. Not shown as an amount because no evidence supports it.</p>}
      {a.conditions && <p className="mt-2 text-sm"><span className="text-muted">Conditions: </span>{a.conditions}</p>}
      {a.benefits && <p className="mt-1 text-sm"><span className="text-muted">Benefits: </span>{a.benefits}</p>}
      {a.evidenceUrl && <button onClick={() => open(a.evidenceUrl)} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><ExternalLink size={13} aria-hidden />Source</button>}

      {a.policy && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">
          <p className="font-medium">General government policy — not this organisation’s confirmed payment</p>
          <p className="mt-1 text-muted">{a.policy.name}: RM{a.policy.rate_amount}/hour, up to {a.policy.hours_per_day} hours per paid day, at most {a.policy.max_paid_days} paid days. {a.policy.caveats}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted" htmlFor="paid-days">Paid working days in a month</label>
            <input id="paid-days" type="number" min={1} max={31} value={days} onChange={(e) => { setDays(Number(e.target.value)); setIll(null) }} className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm tnum" />
            <Button size="sm" onClick={async () => { try { setIll(await api('allowance.illustrate', { paidDays: days })) } catch (e) { toast('bad', errMsg(e)) } }}>Illustrate</Button>
            {ill && <span className="tnum text-sm" role="status">RM{rm(ill.amount)} <span className="text-muted">illustrative ({ill.paidDays} days × {ill.hours} h × RM{a.policy.rate_amount}); not a confirmed payment</span></span>}
          </div>
          <button onClick={() => open(a.policy.source_url)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><ExternalLink size={12} aria-hidden />JPA circular (checked {fmtDate(a.policy.source_checked)})</button>
        </div>
      )}
      {a.nextStep && <div className="mt-3 flex flex-wrap items-center gap-2"><p className="min-w-0 flex-1 text-sm text-muted">{a.nextStep}</p>{onAsk && <Button size="sm" onClick={onAsk}>Ask the employer</Button>}</div>}
    </section>
  )
}
