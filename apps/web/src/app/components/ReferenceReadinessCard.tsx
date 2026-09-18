type ReadinessItem = {
  key: string
  label: string
  detail: string
}

const readinessItems: ReadinessItem[] = [
  {
    key: 'context',
    label: 'Context available',
    detail: 'Inspect the exact files and sources needed for each task.'
  },
  {
    key: 'guarded-writes',
    label: 'Guarded writes',
    detail: 'Apply bounded changes with an explicit path and review boundary.'
  },
  {
    key: 'targeted-validation',
    label: 'Targeted validation',
    detail: 'Run the smallest meaningful checks before creating a commit.'
  }
]

export default function ReferenceReadinessCard() {
  return (
    <section
      aria-labelledby="reference-readiness-title"
      aria-label="Mastermind safety model: ready"
      className="rounded-lg border border-mm-border/70 bg-mm-surface p-5 text-left"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mm-muted">Safety model</p>
          <h2 id="reference-readiness-title" className="mt-1 text-xl font-semibold text-mm-text">
            Local readiness at a glance
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-mm-muted">
            A compact view of the safe workflow behind every Mastermind change.
          </p>
        </div>
        <span className="inline-flex w-fit items-center rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          Ready
        </span>
      </div>

      <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3" role="list">
        {readinessItems.map((item) => (
          <li key={item.key} data-testid={item.key} className="rounded-md border border-mm-border/60 bg-mm-subtle/65 p-4">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 text-lg font-bold text-emerald-600">✓</span>
              <div>
                <h3 className="font-semibold text-mm-text">{item.label}</h3>
                <p className="mt-1 text-sm leading-6 text-mm-muted">{item.detail}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
