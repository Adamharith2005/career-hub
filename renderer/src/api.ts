declare global { interface Window { careerHub: { call(name: string, args?: any): Promise<any>; pathForFile(f: File): string } } }

export const api = (name: string, args?: any): Promise<any> => window.careerHub.call(name, args)
export const errMsg = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method 'api': (Error: )?/, '') : String(e))
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
export const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'bad'
export const REC: Record<string, { label: string; tone: Tone; icon: string }> = {
  APPLY_NOW: { label: 'Apply now', tone: 'ok', icon: '✓' },
  APPLY_WITH_CAVEATS: { label: 'Apply with caveats', tone: 'info', icon: '△' },
  HOLD_INVESTIGATE: { label: 'Hold & investigate', tone: 'warn', icon: '?' },
  SKIP: { label: 'Skip', tone: 'bad', icon: '✕' },
}
export const READY: Record<string, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  RESUME_ONLY: { label: 'Resume only', tone: 'info' },
  READY: { label: 'Ready', tone: 'ok' },
  NEEDS_FIXES: { label: 'Needs fixes', tone: 'bad' },
}
export const STATUS_TONE: Record<string, Tone> = {
  DISCOVERED: 'neutral', SAVED: 'neutral', PREPARING: 'info', READY_TO_APPLY: 'info', APPLIED: 'info', SCREENING: 'warn', ASSESSMENT: 'warn',
  INTERVIEW: 'warn', OFFER: 'ok', ACCEPTED: 'ok', REJECTED: 'bad', WITHDRAWN: 'neutral', NOT_PURSUED: 'neutral',
}
export const STATUS_EXPLAIN: Record<string, string> = {
  VERIFIED_ACTIVE_VACANCY: 'Listing recorded in seed research',
  DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING: 'Programme documented, no listing recorded',
  PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK: 'Careers portal, intern track unconfirmed',
  UNADVERTISED_SPECULATIVE_TARGET: 'Not advertised — enquiry only',
  NEEDS_VERIFICATION: 'Not verified',
}
export const CATEGORY_LABEL: Record<string, string> = {
  EDUCATION: 'Education', SKILL: 'Skills', PROJECT: 'Projects', EXPERIENCE: 'Experience', LEADERSHIP: 'Leadership & activities', CERTIFICATION: 'Certifications', AWARD: 'Awards', LANGUAGE: 'Languages', LINK: 'Links',
}
