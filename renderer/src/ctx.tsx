import { createContext, useContext } from 'react'

export type Page = 'home' | 'applications' | 'companies' | 'imports' | 'resumes' | 'profile' | 'settings'
export interface NewAppOpts { tab?: 'paste' | 'url' | 'company'; companyId?: string }
export interface PrepareOpts { companyId: string; focusRoles?: string[] }
export interface Boot {
  profiles: { profile_id: string; name: string; onboarding_done: boolean; stable_key: string | null; tagline: string; badge: string; applyPlan: string }[]
  activeProfileId: string | null
  profile: any | null
  techNames: string[]
  roleFamilies: { key: string; label: string }[]
  statuses: { key: string; label: string }[]
  companyCount: number
  secureKeyStorage: boolean
  defaultFolder: string
  dataDir: string
  followupDays: number
}
export interface AppContext {
  boot: Boot
  refresh: () => Promise<void>
  go: (p: Page) => void
  openApp: (id: string, tab?: string) => void
  newApp: (o?: NewAppOpts) => void
  prepare: (o: PrepareOpts) => void
  tick: number            // bumps whenever data may have changed so views reload
}
export const Ctx = createContext<AppContext>(null as unknown as AppContext)
export const useApp = () => useContext(Ctx)
export const roleName = (boot: Boot, k?: string | null) => boot.roleFamilies.find((r) => r.key === k)?.label ?? k ?? ''
