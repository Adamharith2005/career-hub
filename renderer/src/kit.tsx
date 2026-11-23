import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import { cx, inputCls } from './ui'

// ---------------------------------------------------------------- brand mark (inline SVG, no assets)
export function Logo({ size = 32 }: { size?: number }) {
  const g = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Career Hub" className="shrink-0">
      <defs><linearGradient id={g} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b9cf6" /><stop offset="1" stopColor="#4338ca" /></linearGradient></defs>
      <rect width="40" height="40" rx="11" fill={`url(#${g})`} />
      <path d="M13 24.5V15.5a3.5 3.5 0 0 1 3.5-3.5h7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M27 15.5v9a3.5 3.5 0 0 1-3.5 3.5h-7" fill="none" stroke="#fff" strokeOpacity=".72" strokeWidth="3" strokeLinecap="round" />
      <circle cx="27" cy="12" r="2.4" fill="#fff" />
    </svg>
  )
}

// ---------------------------------------------------------------- score ring
export type FitBand = 'excellent' | 'strong' | 'possible' | 'low' | 'none'
export const bandOf = (label?: string | null): FitBand =>
  label === 'Excellent target' ? 'excellent' : label === 'Strong target' ? 'strong' : label === 'Possible target' ? 'possible' : label === 'Low match' ? 'low' : 'none'
const BAND_COLOR: Record<FitBand, string> = { excellent: 'var(--ok)', strong: 'var(--primary)', possible: 'var(--warn)', low: 'var(--faint)', none: 'var(--line-strong)' }
const BAND_ICON: Record<FitBand, string> = { excellent: '★', strong: '▲', possible: '◆', low: '▽', none: '–' }
export const bandIcon = (b: FitBand) => BAND_ICON[b]

/** Radial fit meter. Animates from the previous value once when `score` changes; never loops. Number + label carry the meaning, colour only supports it. */
export function ScoreRing({ score, label, size = 40, stroke, showNumber = true }: { score: number | null; label?: string | null; size?: number; stroke?: number; showNumber?: boolean }) {
  const band = score == null ? 'none' : bandOf(label)
  const sw = stroke ?? Math.max(4, Math.round(size / 9))
  const r = (size - sw) / 2, c = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => { const id = requestAnimationFrame(() => setShown(score ?? 0)); return () => cancelAnimationFrame(id) }, [score])
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={score == null ? 'Fit not assessed' : `Target fit ${score} out of 100, ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={sw} />
        {score != null && <circle className="ring-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={BAND_COLOR[band]} strokeWidth={sw} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} />}
      </svg>
      {showNumber && <span className="tnum absolute font-semibold" style={{ fontSize: Math.max(10, size * 0.3) }}>{score == null ? '–' : score}</span>}
    </span>
  )
}

export function FitBar({ value, tone = 'primary' }: { value: number | null; tone?: 'primary' | 'faint' }) {
  const [w, setW] = useState(0)
  useEffect(() => { const id = requestAnimationFrame(() => setW(Math.round((value ?? 0) * 100))); return () => cancelAnimationFrame(id) }, [value])
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface3" aria-hidden>
      {value != null && <div className="bar-fill h-full rounded-full" style={{ width: `${w}%`, background: tone === 'primary' ? 'var(--primary)' : 'var(--faint)' }} />}
    </div>
  )
}

// ---------------------------------------------------------------- autosave
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
export function SavedIndicator({ state, error }: { state: SaveState; error?: string }) {
  return (
    <span aria-live="polite" className="inline-flex h-5 items-center gap-1 text-xs text-faint">
      {state === 'saving' && <><Loader2 size={12} className="spin" aria-hidden />Saving…</>}
      {state === 'saved' && <><Check size={12} className="text-ok" aria-hidden />Saved</>}
      {state === 'error' && <span className="text-bad">{error ?? 'Not saved'}</span>}
    </span>
  )
}

/** Debounced autosave. `save` runs ~`delay` ms after the last change of `value`, only when `ready`. Never fires for the initial value. */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, opts: { ready?: boolean; delay?: number } = {}) {
  const { ready = true, delay = 700 } = opts
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string>()
  const first = useRef(true)
  const latest = useRef(save); latest.current = save
  const key = useMemo(() => JSON.stringify(value), [value])
  const lastSaved = useRef(key)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!ready || key === lastSaved.current) return
    setState('idle')
    const t = setTimeout(async () => {
      setState('saving')
      try { await latest.current(JSON.parse(key) as T); lastSaved.current = key; setError(undefined); setState('saved') }
      catch (e: any) { setError(String(e?.message ?? e).replace(/^Error invoking remote method 'api': (Error: )?/, '')); setState('error') }
    }, delay)
    return () => clearTimeout(t)
  }, [key, ready, delay])
  const markSaved = useCallback(() => { lastSaved.current = key }, [key])
  return { state, error, markSaved }
}

// ---------------------------------------------------------------- chip input (type, Enter/comma to add, suggestions, reorder, remove)
export function ChipInput({ label, values, onChange, suggestions = [], placeholder, hint, max = 40 }: {
  label: string; values: string[]; onChange: (v: string[]) => void; suggestions?: string[]; placeholder?: string; hint?: string; max?: number
}) {
  const id = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const lower = new Set(values.map((v) => v.toLowerCase()))
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q) return []
    return suggestions.filter((s) => s.toLowerCase().includes(q) && !lower.has(s.toLowerCase())).slice(0, 7)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, suggestions, values])
  const add = (raw: string) => {
    const parts = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
    const next = [...values]
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase()) && next.length < max) next.push(p)
    if (next.length !== values.length) onChange(next)
    setText(''); setOpen(false)
  }
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= values.length) return; const n = [...values];[n[i], n[j]] = [n[j], n[i]]; onChange(n) }
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">{label}</label>
      <div className={cx(inputCls, 'flex min-h-[42px] flex-wrap items-center gap-1.5 !px-2 !py-1.5 focus-within:border-primary')}>
        {values.map((v, i) => (
          <span key={v} className="group inline-flex items-center gap-0.5 rounded-full bg-primary-soft py-0.5 pl-2.5 pr-1 text-sm font-medium text-primary">
            <button type="button" aria-label={`Move ${v} earlier`} onClick={() => move(i, -1)} disabled={i === 0} className="hidden rounded p-0.5 hover:bg-surface3 group-focus-within:inline-flex group-hover:inline-flex disabled:opacity-30"><ChevronLeft size={12} aria-hidden /></button>
            {v}
            <button type="button" aria-label={`Move ${v} later`} onClick={() => move(i, 1)} disabled={i === values.length - 1} className="hidden rounded p-0.5 hover:bg-surface3 group-focus-within:inline-flex group-hover:inline-flex disabled:opacity-30"><ChevronRight size={12} aria-hidden /></button>
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="rounded-full p-0.5 hover:bg-surface3"><X size={13} aria-hidden /></button>
          </span>
        ))}
        <input id={id} value={text} role="combobox" aria-expanded={open && matches.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
          onChange={(e) => { setText(e.target.value); setOpen(true); if (/[,;]$/.test(e.target.value)) add(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(text) }
            else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1))
            else if (e.key === 'Escape') setOpen(false)
          }}
          onBlur={() => { if (text.trim()) add(text); setOpen(false) }}
          placeholder={values.length ? '' : placeholder} className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-faint" />
      </div>
      {open && matches.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="card mt-1 max-h-48 overflow-y-auto p-1 shadow-md">
          {matches.map((m) => <li key={m} role="option" aria-selected={false}><button type="button" onMouseDown={(e) => { e.preventDefault(); add(m) }} className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface2">{m}</button></li>)}
        </ul>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

/** Small disclosure used for "How we scored this" etc. */
export function Disclosure({ summary, children, defaultOpen }: { summary: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  const id = useId()
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
        <ChevronRight size={14} className={cx('transition-transform duration-150', open && 'rotate-90')} aria-hidden />{summary}
      </button>
      {open && <div id={id} className="anim-fade mt-2">{children}</div>}
    </div>
  )
}
