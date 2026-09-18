import type { KnowledgeSource } from '@mastermind/shared'
import { ArrowRight, Check, CircleAlert, Info, LoaderCircle } from 'lucide-react'

import { buildSetupSteps, type SetupStepState } from '../state'
import { DashboardButton } from './ui/DashboardButton'
import { DashboardPanel } from './ui/DashboardPanel'
import { DashboardStatusBadge } from './ui/DashboardStatusBadge'

const ACTION_ENDPOINT = 'https://mastermind.prochat.tools'
const ACTIONS = ['Status', 'Read context', 'Apply file change', 'Commit changes', 'Run command']

function stepTone(state: SetupStepState): 'neutral' | 'good' | 'warn' | 'bad' {
  return state === 'ready' ? 'good' : state === 'needs_attention' ? 'bad' : state === 'preparing' ? 'warn' : 'neutral'
}

function stepLabel(state: SetupStepState): string {
  return state === 'ready' ? 'Ready' : state === 'preparing' ? 'Preparing' : state === 'needs_attention' ? 'Needs attention' : state === 'informational' ? 'Guidance' : 'Next step'
}

function StepIcon({ state }: { state: SetupStepState }) {
  if (state === 'ready') return <Check className="h-4 w-4" aria-hidden="true" />
  if (state === 'preparing') return <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
  if (state === 'needs_attention') return <CircleAlert className="h-4 w-4" aria-hidden="true" />
  return <Info className="h-4 w-4" aria-hidden="true" />
}

export function DashboardOnboarding({
  agentConnected,
  sources,
  activeSources,
  error,
  onOpenSources,
  onOpenSettings,
  onOpenGoal,
  onRefresh
}: {
  agentConnected: boolean
  sources: KnowledgeSource[]
  activeSources: KnowledgeSource[]
  error: string | null
  onOpenSources: () => void
  onOpenSettings: () => void
  onOpenGoal: () => void
  onRefresh: () => void
}) {
  const steps = buildSetupSteps({ agentConnected, sources, activeSources, error })
  const ready = steps.find(step => step.id === 'ready')?.state === 'ready'

  return (
    <div className="min-w-0 space-y-4 p-4 sm:p-6">
      <DashboardPanel variant="raised" className="overflow-hidden p-5 sm:p-7">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mm-muted">Welcome to Mastermind</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-mm-text sm:text-3xl">Connect ChatGPT to your local work.</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-mm-muted">Mastermind runs locally and keeps your repository authoritative. It helps ChatGPT read bounded context, propose guarded changes, and show the evidence before work continues.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {ready ? <DashboardButton type="button" variant="primary" onClick={onOpenGoal}>Open Goal / Run <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" /></DashboardButton> : null}
            <DashboardButton type="button" variant={ready ? 'secondary' : 'primary'} onClick={onOpenSources}>{sources.length > 0 ? 'Review Sources' : 'Add a Source'}</DashboardButton>
            <DashboardButton type="button" variant="ghost" onClick={onOpenSettings}>Review Settings</DashboardButton>
          </div>
        </div>
      </DashboardPanel>

      {error ? (
        <DashboardPanel variant="flat" className="border border-red-200/80 bg-red-50/40 p-4 dark:border-red-900/60 dark:bg-red-950/15" role="alert">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-mm-text">Setup needs attention</p>
              <p className="mt-1 text-xs leading-5 text-mm-muted">The workspace could not finish its last check. Technical details remain available in Settings.</p>
            </div>
            <DashboardButton type="button" variant="secondary" onClick={onRefresh}>Refresh</DashboardButton>
          </div>
        </DashboardPanel>
      ) : null}

      <DashboardPanel variant="flat" className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mm-muted">First-run path</p>
            <h3 className="mt-1 text-base font-semibold text-mm-text">A short path to useful work</h3>
          </div>
          <p className="text-xs text-mm-muted">You can use the workspace at any time.</p>
        </div>
        <ol className="mt-5 grid gap-3 lg:grid-cols-5" aria-label="Mastermind setup progress">
          {steps.map((step, index) => (
            <li key={step.id} className="relative min-w-0 rounded-md border border-mm-border/70 bg-mm-surface px-3 py-3 dark:border-slate-800/70 dark:bg-slate-950/35">
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-mm-subtle text-mm-text" aria-hidden="true"><StepIcon state={step.state} /></span>
                <DashboardStatusBadge label={stepLabel(step.state)} tone={stepTone(step.state)} />
              </div>
              <p className="mt-3 text-sm font-semibold text-mm-text">{index + 1}. {step.title}</p>
              <p className="mt-1 text-xs leading-5 text-mm-muted">{step.detail}</p>
              {step.id === 'chatgpt' ? <p className="mt-2 break-all font-mono text-[10px] text-mm-muted">{ACTION_ENDPOINT}</p> : null}
            </li>
          ))}
        </ol>
      </DashboardPanel>

      <DashboardPanel variant="flat" className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mm-muted">What is governed</p>
            <h3 className="mt-1 text-base font-semibold text-mm-text">Five guarded ChatGPT Actions</h3>
          </div>
          <DashboardStatusBadge label="Endpoint guidance" tone="neutral" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Five guarded ChatGPT Actions">
          {ACTIONS.map(action => <span key={action} className="rounded-md bg-mm-subtle px-2.5 py-1.5 text-xs text-mm-muted">{action}</span>)}
        </div>
        <p className="mt-4 max-w-3xl text-xs leading-5 text-mm-muted">Reads are bounded. Writes and commands are governed. Approval may be required. This dashboard does not expose credentials or claim external ChatGPT authentication based only on local runtime health.</p>
      </DashboardPanel>
    </div>
  )
}
