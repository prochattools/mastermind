import ReferenceReadinessCard from './components/ReferenceReadinessCard'

export default function Home() {
  return (
    <main className="min-h-screen bg-mm-canvas px-4 py-8 text-mm-text sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:items-start">
          <section className="min-w-0 pt-4 lg:pt-12" aria-labelledby="welcome-title">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-mm-accent text-sm font-semibold text-mm-surface">M</span>
              <span className="text-sm font-semibold tracking-tight">Mastermind</span>
            </div>
            <p className="mt-10 text-[11px] font-semibold uppercase tracking-[0.14em] text-mm-muted">Local-first control plane</p>
            <h1 id="welcome-title" className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-mm-text sm:text-5xl">Connect ChatGPT to your local work.</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-mm-muted">Mastermind runs locally, prepares Sources you choose, and keeps reads bounded while writes and commands stay governed and reviewable.</p>
            <div className="mt-7 flex flex-wrap gap-2">
              <a href="/dashboard" className="inline-flex min-h-10 items-center justify-center rounded-md border border-mm-accent bg-mm-accent px-4 text-sm font-medium text-mm-surface transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus focus-visible:ring-offset-2 focus-visible:ring-offset-mm-canvas">Open Mastermind</a>
              <a href="#how-it-works" className="inline-flex min-h-10 items-center justify-center rounded-md border border-mm-border bg-mm-surface px-4 text-sm font-medium text-mm-text transition hover:bg-mm-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus focus-visible:ring-offset-2 focus-visible:ring-offset-mm-canvas">See how it works</a>
            </div>
          </section>

          <ReferenceReadinessCard />
        </div>

        <section id="how-it-works" className="mt-10 border-t border-mm-border/70 pt-8" aria-labelledby="how-it-works-title">
          <div className="max-w-2xl"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mm-muted">How it works</p><h2 id="how-it-works-title" className="mt-2 text-xl font-semibold">A clear path from context to safe execution.</h2></div>
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            <li className="rounded-md border border-mm-border/70 bg-mm-surface p-4"><span className="font-mono text-xs text-mm-muted">01</span><h3 className="mt-3 text-sm font-semibold">Choose a Source</h3><p className="mt-1 text-sm leading-6 text-mm-muted">Connect a repository, folder, or workspace Mastermind can work with.</p></li>
            <li className="rounded-md border border-mm-border/70 bg-mm-surface p-4"><span className="font-mono text-xs text-mm-muted">02</span><h3 className="mt-3 text-sm font-semibold">Prepare and read</h3><p className="mt-1 text-sm leading-6 text-mm-muted">Mastermind prepares the Source and gives ChatGPT bounded, exact context.</p></li>
            <li className="rounded-md border border-mm-border/70 bg-mm-surface p-4"><span className="font-mono text-xs text-mm-muted">03</span><h3 className="mt-3 text-sm font-semibold">Review governed work</h3><p className="mt-1 text-sm leading-6 text-mm-muted">Writes, commands, approval, validation, and commits remain visible and controlled.</p></li>
          </ol>
        </section>
      </div>
    </main>
  )
}
