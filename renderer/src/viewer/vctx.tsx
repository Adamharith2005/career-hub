import { createContext, useContext } from 'react'

export type Page = 'explore' | 'profile' | 'resumes' | 'settings'
export interface ProfileSummary { id: string; displayName: string; specialisation: string; university: string; initials: string }
export interface VCtx {
  profiles: ProfileSummary[]
  profile: any                 // full active profile
  profileId: string
  switchProfile: (id: string) => void
  leave: () => void            // back to the picker
  page: Page
  go: (p: Page) => void
  reloadProfile: () => Promise<void>
  /** Company the user wants to look at next (e.g. coming from a link). */
  selected: string | null
  select: (id: string | null) => void
}
export const V = createContext<VCtx>(null as unknown as VCtx)
export const useV = () => useContext(V)
