import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { api, errMsg } from '../api'
import { Button, cx, useToast } from '../ui'

/** Real clipboard write via the main process. Shows a short success micro-interaction. */
export function useCopy() {
  const toast = useToast()
  return async (text: string, what?: string) => {
    try { await api('v.copy.text', { text }); if (what) toast('ok', `Copied ${what}`); return true } catch (e) { toast('bad', errMsg(e)); return false }
  }
}

export function CopyIcon({ text, label, className }: { text: string | (() => Promise<string>); label: string; className?: string }) {
  const copy = useCopy()
  const [done, setDone] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  return (
    <button type="button" aria-label={`Copy ${label}`} data-copy={label} title={`Copy ${label}`} onClick={async () => {
      const s = typeof text === 'string' ? text : await text()
      if (await copy(s)) { setDone(true); clearTimeout(t.current); t.current = setTimeout(() => setDone(false), 1400) }
    }} className={cx('press grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-surface2 hover:text-ink', done && 'text-ok', className)}>
      {done ? <Check key="ok" size={14} className="anim-pop" aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  )
}

export function CopyButton({ text, children, size = 'sm', variant = 'secondary', testId }: { text: string | (() => Promise<string>); children: React.ReactNode; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' | 'ghost'; what?: string; testId?: string }) {
  const copy = useCopy()
  const [done, setDone] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  return (
    <Button size={size} variant={variant} data-testid={testId} onClick={async () => {
      try {
        const s = typeof text === 'string' ? text : await text()
        if (await copy(s)) { setDone(true); clearTimeout(t.current); t.current = setTimeout(() => setDone(false), 1600) }
      } catch (e) { /* toast shown by copy() for clipboard errors; text() errors surface below */ console.error(errMsg(e)) }
    }} icon={done ? <Check size={14} className="anim-pop text-ok" aria-hidden /> : <Copy size={14} aria-hidden />}>
      {done ? 'Copied' : children}
    </Button>
  )
}
