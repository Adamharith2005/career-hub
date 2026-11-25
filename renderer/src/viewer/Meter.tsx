import { useEffect, useRef, useState } from 'react'
import { cx } from '../ui'

export const TIER_LABEL: Record<string, string> = { EXCELLENT: 'Excellent alignment', STRONG: 'Strong alignment', MODERATE: 'Moderate alignment', LIMITED: 'Limited alignment' }
const TIER_SHAPE: Record<string, string> = { EXCELLENT: '◆◆◆◆', STRONG: '◆◆◆◇', MODERATE: '◆◆◇◇', LIMITED: '◆◇◇◇' }
export const tierClass = (t: string) => `tier-${(t || 'limited').toLowerCase()}`

const reduced = () => document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Counts up to `value` once on mount and eases to any later change. Instant when motion is reduced. */
export function useCount(value: number, ms = 800) {
  const [n, setN] = useState(() => (reduced() ? value : 0))
  const from = useRef(reduced() ? value : 0)
  useEffect(() => {
    if (reduced()) { setN(value); from.current = value; return }
    const a = from.current, t0 = performance.now(); let raf = 0
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); const v = Math.round(a + (value - a) * e); setN(v); from.current = v; if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return n
}

/** Signature match ring. The percentage is always printed; the tier is always written; the diamonds repeat it without colour. */
export function MatchRing({ score, tier, provisional, size = 64, label = true, className }: { score: number; tier: string; provisional?: boolean; size?: number; label?: boolean; className?: string }) {
  const n = useCount(score)
  const r = (size - 8) / 2, c = 2 * Math.PI * r
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(t) }, [])
  const off = c * (1 - (ready ? score : 0) / 100)
  const text = `${score} percent ${provisional ? 'provisional ' : ''}match. ${TIER_LABEL[tier] ?? ''}`
  return (
    <div className={cx('inline-flex items-center gap-2.5', tierClass(tier), className)} role="img" aria-label={text} data-testid="match-ring" data-score={score}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 -rotate-90">
        <circle className="meter-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={size > 80 ? 9 : 6} />
        <circle className="meter-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tier)" strokeWidth={size > 80 ? 9 : 6} strokeLinecap="round" strokeDasharray={provisional ? `${c * 0.04} ${c * 0.03}` : c} strokeDashoffset={provisional ? 0 : off} style={provisional ? { strokeDasharray: `${c * 0.045} ${c * 0.035}`, opacity: ready ? 1 : 0, transition: 'opacity .6s' } : undefined} />
        {provisional && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tier)" strokeWidth={size > 80 ? 9 : 6} strokeLinecap="round" strokeDasharray={`${c * (score / 100)} ${c}`} opacity={0.25} />}
      </svg>
      <span className="leading-none">
        <span className="figure block text-ink" style={{ fontSize: size * 0.34 }}>{n}<span className="font-semibold text-muted" style={{ fontSize: size * 0.2 }}>%</span></span>
        {label && <span className="mt-1 block text-[11.5px] font-semibold tier-text">{provisional ? 'Provisional' : TIER_LABEL[tier]?.replace(' alignment', '')}{size >= 90 && <span aria-hidden className="ml-1 tracking-tighter opacity-80">{TIER_SHAPE[tier]}</span>}</span>}
      </span>
    </div>
  )
}

export function Bar({ value, tone = 'var(--primary)', delay = 0 }: { value: number; tone?: string; delay?: number }) {
  const [w, setW] = useState(reduced() ? value : 0)
  useEffect(() => { const t = setTimeout(() => setW(value), reduced() ? 0 : 40 + delay); return () => clearTimeout(t) }, [value, delay])
  return <div className="bar-track" role="presentation"><div className="bar-fill2" style={{ width: `${Math.round(w * 100)}%`, background: tone }} /></div>
}
