import type { ProfileSummary } from './vctx'

const NOTE: Record<string, string> = { adam: 'Data, analytics and machine-learning teams', akif: 'Software, cloud and information-systems teams' }

/** Title page: the question, then each person as a colour-coded door. The colours carry on inside the app. */
export function Picker({ profiles, onPick }: { profiles: ProfileSummary[]; onPick: (id: string) => void }) {
  return (
    <main className="flex min-h-full flex-col px-12 py-10 max-[860px]:px-6">
      <p className="font-display text-[1.5rem] leading-none">Career Hub</p>
      <div className="mx-auto my-auto w-full max-w-[1080px] py-10">
        <h1 className="anim-detail font-display text-[clamp(2.6rem,5.4vw,4.6rem)] leading-[1.02]">Who’s exploring today?</h1>
        <p className="anim-detail mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted" style={{ animationDelay: '60ms' }}>Researched organisations in Cyberjaya, Putrajaya and IOI Resort City, matched to your own projects and skills, with a tailored CV ready for each one.</p>
        <div className="mt-9 grid grid-cols-2 gap-5 max-[860px]:grid-cols-1" role="list" aria-label="Profiles">
          {profiles.map((p, i) => (
            <button key={p.id} role="listitem" data-testid={`pick-${p.id}`} onClick={() => onPick(p.id)} style={{ animationDelay: `${140 + i * 90}ms` }} className={`anim-fade-up pick pick-${p.id} group relative flex min-h-[270px] flex-col justify-between overflow-hidden rounded-3xl p-8 text-left`}>
              <span aria-hidden className="pick-orb" />
              <span className="relative z-[1] grid h-14 w-14 place-items-center rounded-2xl bg-white/20 text-[1.35rem] font-extrabold tracking-tight text-white backdrop-blur-sm">{p.initials}</span>
              <span className="relative z-[1]">
                <span className="font-display block text-[clamp(2.4rem,4vw,3.6rem)] leading-none text-white">{p.displayName}</span>
                <span className="mt-2 block text-[15px] font-semibold text-white/95">{p.specialisation}</span>
                <span className="mt-0.5 block text-[13.5px] text-white/85">{p.university} · {NOTE[p.id] ?? ''}</span>
              </span>
              <span className="pick-go absolute bottom-7 right-7 z-[1] grid h-11 w-11 place-items-center rounded-full bg-white text-[1.1rem] font-bold" aria-hidden>→</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12.5px] text-faint">Private and offline. No account, no tracking.</p>
    </main>
  )
}
