import type { Fact, Profile } from './profiles.ts'
import { auditFacts } from './integrity.ts'

/**
 * "Ready to tailor" is a plain checklist, not a competency score. Five required items decide readiness;
 * optional items only improve documents. The single `next` item is the most useful thing still missing.
 */
export interface CompletionItem { key: string; label: string; done: boolean; required: boolean; hint: string; section: string }
export interface Completion { ready: boolean; items: CompletionItem[]; requiredDone: number; requiredTotal: number; next: CompletionItem | null; reviewCount: number }

export function profileCompletion(profile: Pick<Profile, 'identity' | 'roles' | 'prefs' | 'name'>, factsIn: Fact[]): Completion {
  const facts = factsIn.filter((f) => f.confirmed)
  const has = (c: Fact['category']) => facts.filter((f) => f.category === c)
  const skillCount = has('SKILL').reduce((n, f) => n + f.tools.length, 0)
  const items: CompletionItem[] = [
    { key: 'name', label: 'Your full name', done: !!(profile.identity.fullName ?? profile.name)?.trim(), required: true, section: 'basics', hint: 'Add your full name so documents are addressed correctly.' },
    { key: 'roles', label: 'Target role(s)', done: (profile.roles as string[]).length > 0, required: true, section: 'roles', hint: 'Choose the CS roles you want — this ranks companies for you.' },
    { key: 'education', label: 'Education', done: has('EDUCATION').length > 0, required: true, section: 'education', hint: 'Add your university and programme.' },
    { key: 'skills', label: 'At least one skill', done: skillCount > 0, required: true, section: 'skills', hint: 'Add a few skills you can honestly point to.' },
    { key: 'project', label: 'A project or experience', done: has('PROJECT').length + has('EXPERIENCE').length > 0, required: true, section: 'projects', hint: 'Add a project to strengthen your applications — it is your main proof.' },
    { key: 'email', label: 'Email address', done: !!profile.identity.email?.trim(), required: false, section: 'basics', hint: 'Add an email so your resume and drafts include a way to reach you.' },
    { key: 'availability', label: 'Internship dates', done: !!profile.prefs.internshipStart, required: false, section: 'availability', hint: 'Add when you are available — employers ask first.' },
    { key: 'links', label: 'GitHub or portfolio link', done: !!(profile.identity.github || profile.identity.portfolio || profile.identity.linkedin), required: false, section: 'links', hint: 'A GitHub or LinkedIn link lets employers see your work.' },
  ]
  const req = items.filter((i) => i.required)
  const reviewCount = auditFacts(factsIn).length
  return { ready: req.every((i) => i.done), items, requiredDone: req.filter((i) => i.done).length, requiredTotal: req.length, next: items.find((i) => !i.done) ?? null, reviewCount }
}
