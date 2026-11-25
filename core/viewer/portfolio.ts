/** Checks that a profile's project inventory covers the projects it is supposed to. Pure, no I/O. */
import type { Profile } from './store.ts'

export interface Coverage { missing: string[]; noBullets: string[]; onMaster: string[]; uncertainOnMaster: string[]; awardsWithoutProject: string[] }

/** `required` are inventory ids. A project may be in the bank without being on the master, but it must exist. */
export function portfolioCoverage(p: Pick<Profile, 'projects' | 'awards'>, required: string[]): Coverage {
  const by = new Map(p.projects.filter((x) => x.id).map((x) => [x.id!, x]))
  const missing = required.filter((id) => !by.has(id))
  const noBullets = required.filter((id) => { const x = by.get(id); return x && x.contribution !== 'TEAM_UNCERTAIN' && !x.bullets?.length && x.master != null })
  const onMaster = p.projects.filter((x) => x.master != null || x.additional).map((x) => x.id ?? x.title)
  const uncertainOnMaster = p.projects.filter((x) => x.contribution === 'TEAM_UNCERTAIN' && (x.master != null || x.additional)).map((x) => x.id ?? x.title)
  const awardsWithoutProject = (p.awards ?? []).filter((a) => !p.projects.some((x) => x.award && a.title.split(':')[0] && x.award.includes(a.title.split(/[:(]/)[0].trim().slice(0, 12)))).map((a) => a.title)
  return { missing, noBullets, onMaster, uncertainOnMaster, awardsWithoutProject }
}
