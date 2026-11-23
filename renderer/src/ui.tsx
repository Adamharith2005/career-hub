import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, X, XCircle } from 'lucide-react'
import type { Tone } from './api'

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

// ---------------------------------------------------------------- Button
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; busy?: boolean; icon?: React.ReactNode }
export function Button({ variant = 'secondary', size = 'md', busy, icon, children, className, disabled, ...p }: BtnProps) {
  const v = {
    primary: 'bg-primary text-on-primary hover:bg-primary-hover border-transparent',
    secondary: 'bg-surface text-ink border-line-strong hover:bg-surface2',
    ghost: 'bg-transparent text-muted border-transparent hover:bg-surface2 hover:text-ink',
    danger: 'bg-surface text-bad border-line-strong hover:bg-bad-bg',
  }[variant]
  return (
    <button {...p} disabled={disabled || busy} className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors duration-150 disabled:opacity-55', size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm', v, className)}>
      {busy ? <Loader2 size={15} className="spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- Chip (never colour-only: icon + text)
const TONE: Record<Tone, string> = { neutral: 'bg-surface2 text-muted', info: 'bg-info-bg text-info', ok: 'bg-ok-bg text-ok', warn: 'bg-warn-bg text-warn', bad: 'bg-bad-bg text-bad' }
export function Chip({ tone = 'neutral', children, icon, className, title }: { tone?: Tone; children: React.ReactNode; icon?: React.ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONE[tone], className)}>{icon}{children}</span>
}

export function Toggle({ on, onClick, children, disabled, className }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} disabled={disabled} onClick={onClick}
      className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors duration-150', on ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line-strong bg-surface text-muted hover:bg-surface2', className)}>
      <span aria-hidden className={cx('grid h-4 w-4 place-items-center rounded-full border text-[10px]', on ? 'border-primary bg-primary text-on-primary' : 'border-line-strong')}>{on ? '✓' : ''}</span>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- Fields
export const inputCls = 'rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus-visible:border-primary'
export function Field({ label, hint, children, error, className }: { label: string; hint?: string; children: (id: string) => React.ReactNode; error?: string; className?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">{label}</label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  )
}
const wcls = (c?: string) => (c && /(^|\s)w-/.test(c) ? '' : 'w-full')
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) { return <input ref={ref} {...p} className={cx(inputCls, wcls(className), className)} /> })
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) { return <textarea ref={ref} {...p} className={cx(inputCls, wcls(className), 'resize-y leading-relaxed', className)} /> })
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={cx(inputCls, wcls(className), 'pr-8', className)}>{children}</select> }

// ---------------------------------------------------------------- Modal (focus trap, Esc, restores focus)
export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const labelId = useId()
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current!
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.hasAttribute('disabled'))
    ;(el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[1] ?? focusables()[0])?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    el.addEventListener('keydown', onKey)
    return () => { el.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="anim-fade fixed inset-0 z-50 grid place-items-center bg-black/35 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelId} className={cx('anim-fade-up flex max-h-[92vh] w-full flex-col rounded-xl border border-line bg-surface shadow-[0_8px_30px_rgba(0,0,0,.14)]', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={labelId} className="text-base font-semibold">{title}</h2>
          <button aria-label="Close dialog" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface2"><X size={18} /></button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Tabs (roving focus, arrow keys)
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { key: T; label: string; badge?: React.ReactNode }[]; value: T; onChange: (k: T) => void; label: string }) {
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === value)
    if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].key)
    if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].key)
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--line)]">
      {tabs.map((t) => (
        <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={value === t.key} aria-controls={`panel-${t.key}`} tabIndex={value === t.key ? 0 : -1} onClick={() => onChange(t.key)}
          className={cx('flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors duration-150', value === t.key ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}{t.badge}
        </button>
      ))}
    </div>
  )
}

export function Accordion({ title, children, defaultOpen, right }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  const id = useId()
  return (
    <section className="border-t border-line first:border-t-0">
      <h3>
        <button aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 py-3 text-left text-sm font-semibold">
          <ChevronDown size={16} className={cx('shrink-0 text-muted transition-transform duration-150', open ? 'rotate-0' : '-rotate-90')} aria-hidden />
          <span className="flex-1">{title}</span>{right}
        </button>
      </h3>
      {open && <div id={id} className="anim-fade pb-4 pl-6">{children}</div>}
    </section>
  )
}

export function Banner({ tone = 'info', title, children, action }: { tone?: Tone; title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'bad' ? XCircle : tone === 'warn' ? AlertTriangle : Info
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-sm', TONE[tone])}>
      <Icon size={17} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{title && <p className="font-semibold">{title}</p>}{children && <div className={title ? 'opacity-90' : ''}>{children}</div>}</div>
      {action}
    </div>
  )
}

export const Spinner = ({ label = 'Loading' }: { label?: string }) => <div role="status" className="flex items-center gap-2 p-6 text-muted"><Loader2 size={16} className="spin" aria-hidden />{label}…</div>
export function Empty({ title, children, action, icon }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-12 text-center">
      {icon && <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-surface2 text-muted">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="mt-1.5 text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
export const Progress = ({ value, label }: { value: number; label: string }) => (
  <div role="progressbar" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
    <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.round(value * 100)}%` }} />
  </div>
)

// ---------------------------------------------------------------- Toasts
export type ToastAction = { label: string; onClick: () => void }
type ToastItem = { id: number; tone: Tone; text: string; action?: ToastAction }
const ToastCtx = createContext<(tone: Tone, text: string, action?: ToastAction) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((tone: Tone, text: string, action?: ToastAction) => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x.slice(-3), { id, tone, text, action }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), action ? 8000 : tone === 'bad' ? 7000 : 3800)
  }, [])
  const dismiss = (id: number) => setItems((x) => x.filter((i) => i.id !== id))
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'bad' ? 'alert' : 'status'} className="anim-slide pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm shadow-[0_4px_16px_rgba(0,0,0,.12)]">
            {t.tone === 'bad' ? <XCircle size={17} className="mt-0.5 shrink-0 text-bad" aria-hidden /> : t.tone === 'warn' ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warn" aria-hidden /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-ok" aria-hidden />}
            <span className="min-w-0 flex-1 break-words">{t.text}</span>
            {t.action && <button onClick={() => { t.action!.onClick(); dismiss(t.id) }} className="shrink-0 rounded-md px-2 py-0.5 text-sm font-semibold text-primary hover:bg-primary-soft">{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [state, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const run = useCallback(() => {
    let alive = true
    set((s) => ({ ...s, loading: true }))
    fn().then((data) => alive && set({ data, error: null, loading: false }), (e) => alive && set({ data: null, error: e?.message ?? String(e), loading: false }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => run(), [run])
  return { ...state, reload: run }
}

export function copyText(text: string) { return navigator.clipboard.writeText(text) }
