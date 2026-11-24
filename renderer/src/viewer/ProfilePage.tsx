import { ExternalLink } from 'lucide-react'
import { api } from '../api'
import { Empty, Spinner } from '../ui'
import { CopyButton, CopyIcon } from './Copy'
import { DocViewer, useDocs } from './Docs'
import { useV } from './vctx'

const STATUS: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'neutral' }> = { COMPLETED: { label: 'Completed', tone: 'ok' }, IN_PROGRESS: { label: 'In progress', tone: 'info' }, PROPOSED: { label: 'Proposed / in progress', tone: 'warn' }, UNKNOWN: { label: 'Status not recorded', tone: 'neutral' } }

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-2.5 mt-7 border-t border-line pt-4 text-[15px] font-semibold first:mt-0 first:border-t-0 first:pt-0">{children}</h2>
function Line({ label, v }: { label: string; v: string }) { return v ? <div className="flex items-center gap-1.5 text-sm"><span className="w-16 shrink-0 text-muted">{label}</span><span className="min-w-0 truncate">{v}</span><CopyIcon text={v} label={label.toLowerCase()} /></div> : null }

export function ProfilePage() {
  const { profile: p, profileId } = useV()
  const { docs } = useDocs(profileId)
  return (
    <div className="scroll-thin h-full overflow-y-auto px-8 py-6">
      <header className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-line pb-5">
        <div className="min-w-0 flex-1"><h1 className="page-title" data-testid="profile-name">{p.fullName || p.displayName}</h1><p className="mt-2 text-[14px] text-muted">{p.degree || p.specialisation} · {p.university}</p></div>
        <CopyButton variant="primary" size="sm" what="profile summary" text={() => api('v.profile.copy', { id: profileId })}>Copy profile text</CopyButton>
      </header>
      {p.reviewNotes.length > 0 && <aside className="mb-6 border-l-2 border-warn pl-4 text-[13.5px]" aria-label="Worth a quick check"><p className="font-medium">Worth a quick check (optional)</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{p.reviewNotes.map((n: string) => <li key={n}>{n}</li>)}</ul></aside>}
      <div className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <H>Contact</H>
          <div className="space-y-1"><Line label="Email" v={p.contact.email} /><Line label="Phone" v={p.contact.phone} /><Line label="Location" v={p.contact.location} />{p.links.map((l: any) => <div key={l.url} className="flex items-center gap-1.5 text-sm"><span className="w-16 shrink-0 text-muted">{l.label}</span><button className="min-w-0 truncate text-left text-primary hover:underline" onClick={() => api('v.openExternal', { url: l.url })}>{l.url.replace(/^https?:\/\/(www\.)?/, '')}</button><CopyIcon text={l.url} label={l.label.toLowerCase()} /></div>)}</div>
          {p.summary && <><H>Summary</H><p className="text-sm leading-relaxed">{p.summary}</p></>}
          {p.education.length > 0 && <><H>Education</H><ul className="space-y-3">{p.education.map((e: any) => <li key={e.title + e.institution}><p className="text-sm font-semibold">{e.title}</p><p className="text-sm text-muted">{e.institution}{e.dates && <span className="num-display"> · {e.dates}</span>}</p>{e.points.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm">{e.points.map((x: string) => <li key={x}>{x}</li>)}</ul>}</li>)}</ul></>}
          {p.skills.length > 0 && <><H>Skills</H><dl className="space-y-2">{p.skills.map((s: any) => <div key={s.group}><dt className="text-[13px] font-medium">{s.group}</dt><dd className="mt-0.5 text-[14px] text-muted">{s.items.join(", ")}</dd></div>)}</dl></>}
          {p.projects.length > 0 && <><H>Projects</H><ul className="divide-y divide-line">{p.projects.map((pr: any) => { const st = STATUS[pr.status] ?? STATUS.UNKNOWN; return (
            <li key={pr.title} className="py-3 first:pt-0"><p className="text-[14.5px] font-semibold leading-snug">{pr.title}</p>
              <p className="mt-0.5 text-[12.5px] text-muted">{[st.label, pr.context, pr.date].filter(Boolean).join(" · ")}</p>
              {pr.stack.length > 0 && <p className="mt-1 font-mono text-[12.5px] text-muted">{pr.stack.join(", ")}</p>}
              {pr.points.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">{pr.points.map((x: string) => <li key={x}>{x}</li>)}</ul>}
              {pr.caveat && <p className="mt-2 border-l-2 border-line-strong pl-3 text-[12.5px] text-muted">{pr.caveat}</p>}
              {pr.url && <button className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline" onClick={() => api('v.openExternal', { url: pr.url })}><ExternalLink size={12} aria-hidden />Public repository</button>}</li>) })}</ul></>}
          {p.experience.length > 0 && <><H>Experience</H><ul className="space-y-2">{p.experience.map((e: any) => <li key={e.title + e.organisation} className="text-sm"><b className="font-semibold">{e.title}</b>, {e.organisation}{e.date && <span className="text-muted"> · {e.date}</span>}{e.points.map((x: string) => <p key={x} className="text-muted">{x}</p>)}</li>)}</ul></>}
          {p.leadership.length > 0 && <><H>Leadership & College Involvement</H><ul className="space-y-2">{[...p.leadership].sort((a: any, b: any) => (b.year ?? 0) - (a.year ?? 0)).map((e: any) => <li key={e.id ?? e.title + e.organisation + e.date} className="text-sm"><b className="font-semibold">{e.title}</b>, {e.organisation}{e.date && <span className="figure text-muted"> · {e.date}</span>}{e.points.map((x: string) => <p key={x} className="text-muted">{x}</p>)}</li>)}</ul></>}
          {p.interests.length > 0 && <><H>Internship interests</H><p className="text-[14px]">{p.interests.join(" · ")}</p><p className="mt-1.5 text-xs text-muted">Exploration areas, not claims of mastery.{p.internshipWindow && ` Timing: ${p.internshipWindow}.`}</p></>}
          {p.languages.length > 0 && <><H>Languages</H><p className="text-sm">{p.languages.join(' · ')}</p></>}
          {p.otherRepos.length > 0 && <><H>Other public repositories</H><p className="mb-2 text-xs text-muted">Listed for reference from public pages. Not treated as verified achievements.</p><ul className="space-y-2">{p.otherRepos.map((r: any) => <li key={r.name} className="text-sm"><button className="font-medium text-primary hover:underline" onClick={() => api('v.openExternal', { url: r.url })}>{r.name}</button><span className="text-muted"> — {r.note}</span></li>)}</ul></>}
        </div>
        <div className="min-w-0 xl:sticky xl:top-0 xl:self-start">
          <H>CV & resume</H>
          {!docs ? <Spinner /> : docs.length ? <DocViewer profileId={profileId} docs={docs} /> : <Empty title="No CV or resume linked yet">Your profile above is already usable. Link a file any time in My Resumes.</Empty>}
        </div>
      </div>
    </div>
  )
}
