import { cx } from '../ui'

export type MarkKind = 'verified' | 'probable' | 'unverified' | 'unknown' | 'none'
const WORD: Record<MarkKind, string> = { verified: 'Verified', probable: 'Probable', unverified: 'Unverified', unknown: 'Unknown', none: 'None' }

/** The evidence mark. Always has a text equivalent, so meaning never rests on shape or colour alone. */
export function Mark({ kind, className }: { kind: MarkKind; className?: string }) {
  return <span role="img" aria-label={WORD[kind]} title={WORD[kind]} className={cx('mark', `mark-${kind}`, className)} />
}

export const allowanceMark = (status: string): MarkKind => status === 'CONFIRMED_PAID' ? 'verified' : status === 'HISTORICAL' ? 'probable' : status === 'ESTIMATED' ? 'unverified' : status === 'CONFIRMED_UNPAID' ? 'none' : 'unknown'
export const evidenceMark = (e: string): MarkKind => e === 'ACTIVE_OPENING' || e === 'CONFIRMED_PROGRAMME' ? 'verified' : e === 'REPORTED_PROGRAMME' || e === 'HISTORICAL' ? 'probable' : e === 'NOT_ACCEPTING' ? 'none' : e === 'DIRECT_OUTREACH' ? 'unverified' : 'unknown'
export const officeMark = (s: string): MarkKind => s === 'VERIFIED' ? 'verified' : s === 'PROBABLE' ? 'probable' : 'unverified'
