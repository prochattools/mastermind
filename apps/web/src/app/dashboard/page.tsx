'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { FormEvent } from 'react'
import { Menu, Plus, X } from 'lucide-react'
import type { ActiveSourcesMode, DiscoveredRepository, KnowledgeSource, WriteMode } from '@mastermind/shared'
import { DashboardButton } from './components/ui/DashboardButton'
import { DashboardIconButton } from './components/ui/DashboardIconButton'
import { DashboardShell } from './components/DashboardShell'
import { DashboardRail } from './components/DashboardRail'
import { DashboardTopBar } from './components/DashboardTopBar'
import { ActiveContextPanel } from './components/ActiveContextPanel'
import { DashboardFoundationView } from './components/DashboardFoundationView'
import { WorkflowSurface } from './components/WorkflowSurface'
import type { DashboardActivityLine, DashboardJob, DashboardPacket, DashboardRuntimeEvent } from './types'
import type { DashboardSection } from './types'
import type { StatusTone } from './status'
import { getAuthorityLabel, getSystemHealth } from './status'
import { humanizeRuntimeEvent } from './workflow'

const CACHE_KEY = 'mastermind-dashboard-source-snapshot'
const DEFAULT_REPO_ROOT = '~/Repos'
const THEME_KEY = 'mastermind-theme'

type SourceSnapshot = {
  sources: KnowledgeSource[]
  activeMode: ActiveSourcesMode
  activeSourceIds: string[]
  savedAt: string
}

type Theme = 'light' | 'dark' | 'system'

// Retained for the legacy observability helpers below; the mounted workflow surface is authoritative.
type AgentDashboardJob = DashboardJob

const terminalStatuses = new Set(['ready', 'failed', 'disabled'])

const readSnapshot = (): SourceSnapshot | null => {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SourceSnapshot>
    if (!Array.isArray(parsed.sources)) return null
    return {
      sources: parsed.sources,
      activeMode: parsed.activeMode || 'all',
      activeSourceIds: Array.isArray(parsed.activeSourceIds) ? parsed.activeSourceIds : [],
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString()
    }
  } catch {
    return null
  }
}

const saveSnapshot = (snapshot: SourceSnapshot) => {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
  } catch {}
}

const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const message = typeof data.userMessage === 'string'
      ? data.userMessage
      : typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : `Request failed: ${response.status}`
    throw new Error(message)
  }
  return data
}

const countLabel = (count: number, label: string) => `${count} ${label}${count === 1 ? '' : 's'}`

export default function Dashboard() {
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [activeMode, setActiveMode] = useState<ActiveSourcesMode>('all')
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [agentConnected, setAgentConnected] = useState(false)
  const [activeSection, setActiveSection] = useState<DashboardSection>('overview')
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [writeMode, setWriteMode] = useState<WriteMode>('readOnly')
  const [busySourceId, setBusySourceId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [sourcePath, setSourcePath] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [discoveryRootPath, setDiscoveryRootPath] = useState(DEFAULT_REPO_ROOT)
  const [discoveredRepos, setDiscoveredRepos] = useState<DiscoveredRepository[]>([])
  const [selectedDiscoveredRepoPath, setSelectedDiscoveredRepoPath] = useState('')
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [discoveryScanned, setDiscoveryScanned] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<DashboardActivityLine[]>([])
  const [agentJobs, setAgentJobs] = useState<DashboardJob[]>([])
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>('system')
  const hydratedRef = useRef(false)
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const addSourceTriggerRef = useRef<HTMLElement | null>(null)
  const addSourceDialogRef = useRef<HTMLDivElement>(null)

  const activeSources = useMemo(() => sources.filter(s => activeSourceIds.includes(s.id)), [sources, activeSourceIds])
  const enabledSources = useMemo(() => sources.filter(s => s.enabled), [sources])
  const availableDiscoveredRepos = useMemo(() => discoveredRepos.filter(r => !r.alreadyAdded), [discoveredRepos])
  const selectedDiscoveredRepo = useMemo(
    () => discoveredRepos.find(r => r.path === selectedDiscoveredRepoPath) || null,
    [discoveredRepos, selectedDiscoveredRepoPath]
  )
  const branchGroupFor = useCallback((source: KnowledgeSource, enabledOnly = false) => {
    const group = source.repoGroupId
      ? sources.filter(item => item.repoGroupId === source.repoGroupId && (!enabledOnly || item.enabled))
      : [source].filter(item => !enabledOnly || item.enabled)
    return group.length > 0 ? group : [source]
  }, [sources])

  const applyTheme = useCallback((t: Theme) => {
    const root = document.documentElement
    if (t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null
    const initial = saved || 'system'
    setTheme(initial)
    applyTheme(initial)
  }, [applyTheme])

  const cycleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    setTheme(next)
    localStorage.setItem(THEME_KEY, next)
    applyTheme(next)
  }

  const selectSource = (id: string) => {
    setSelectedSourceId(id)
    setActiveSection('sources')
    closeMobileNavigation()
  }

  const openAddSource = () => {
    addSourceTriggerRef.current = document.activeElement as HTMLElement | null
    setShowAddModal(true)
  }

  const closeAddSource = () => {
    setShowAddModal(false)
    window.setTimeout(() => addSourceTriggerRef.current?.focus(), 0)
  }

  const closeMobileNavigation = () => {
    setMobileNavigationOpen(false)
    window.setTimeout(() => mobileMenuButtonRef.current?.focus(), 0)
  }

  const pushActivity = (label: string, detail: string, tone: StatusTone = 'neutral') => {
    setActivity(current => [{ id: `${Date.now()}-${label}`, label, detail, tone, timestamp: new Date().toISOString() }, ...current].slice(0, 5))
  }

  const refreshAgentJobs = async (silent = true) => {
    try {
      const data = await fetchJson('/api/agent/jobs')
      const packets = Array.isArray(data.packets) ? data.packets as DashboardPacket[] : []
      const jobs = (Array.isArray(data.jobs) ? data.jobs as DashboardJob[] : []).map(job => ({
        ...job,
        packets: packets.filter(packet => packet.runId === job.id)
      }))
      const events = Array.isArray(data.events) ? data.events as DashboardRuntimeEvent[] : []
      setAgentJobs(jobs)
      if (events.length > 0) {
        const eventActivity = events.map(humanizeRuntimeEvent)
        setActivity(current => [...eventActivity, ...current.filter(item => !events.some(event => event.id === item.id))].slice(0, 12))
      }
      if (!silent && events.length > 0) {
        const event = events[0]
        pushActivity('Activity updated', event.message, event.type.includes('failed') || event.type.includes('blocked') ? 'bad' : event.type.includes('paused') ? 'warn' : 'good')
      } else if (!silent && jobs.length > 0) {
        const active = jobs.find(j => ['queued', 'running', 'needs_confirmation', 'paused', 'blocked'].includes(j.status)) || jobs[0]
        pushActivity('Run updated', active.activeTask?.title || active.summary || 'Current run state refreshed.', active.status === 'blocked' || active.status === 'failed' ? 'bad' : active.status === 'needs_confirmation' || active.status === 'paused' ? 'warn' : 'good')
      }
      return jobs
    } catch (err) {
      if (!silent) pushActivity('Activity unavailable', err instanceof Error ? err.message : String(err), 'warn')
      return agentJobs
    }
  }

  const controlAgentJob = async (job: AgentDashboardJob, action: 'pause' | 'resume' | 'cancel') => {
    if (action === 'cancel') {
      const confirmed = window.confirm(`Cancel run ${job.id}? This stops the run and any queued or running packets.`)
      if (!confirmed) return
    }

    try {
      setBusyJobId(job.id)
      setError(null)
      const data = await fetchJson('/api/agent/jobs/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, action, reason: `Dashboard ${action}` })
      })
      const events = Array.isArray(data.events) ? data.events as DashboardRuntimeEvent[] : []
      const latest = events[0]
      pushActivity(
        `Run ${action}`,
        latest ? latest.message : `The run was asked to ${action}.`,
        action === 'cancel' ? 'warn' : 'good'
      )
      await refreshAgentJobs(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      pushActivity(`Run ${action} failed`, message, 'bad')
    } finally {
      setBusyJobId(null)
    }
  }

  const refreshSources = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      setError(null)
      const [sourcesData, activeData, writeData] = await Promise.all([
        fetchJson('/api/agent/sources'),
        fetchJson('/api/agent/active-sources'),
        fetchJson('/api/agent/write-mode'),
        refreshAgentJobs(true)
      ])
      const nextSources = Array.isArray(sourcesData.sources) ? sourcesData.sources as KnowledgeSource[] : []
      const nextActiveIds = Array.isArray(activeData.activeSourceIds) ? activeData.activeSourceIds as string[] : []
      const nextMode = (activeData.mode as ActiveSourcesMode) || (nextActiveIds.length > 1 ? 'multi' : 'single')
      const snapshot = {
        sources: nextSources,
        activeMode: nextMode,
        activeSourceIds: nextActiveIds,
        savedAt: new Date().toISOString()
      }
      setSources(nextSources)
      setActiveMode(nextMode)
      setActiveSourceIds(nextActiveIds)
      if (writeData.writeMode === 'readOnly' || writeData.writeMode === 'artifactsOnly' || writeData.writeMode === 'safeWrites') {
        setWriteMode(writeData.writeMode)
      }
      setAgentConnected(true)
      setNotice(null)
      saveSnapshot(snapshot)
      if (!silent) pushActivity('Sources refreshed', `${countLabel(nextSources.length, 'source')} · ${countLabel(nextActiveIds.length, 'active source')}`, 'good')
      return nextSources
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setAgentConnected(false)
      setError(message)
      if (!silent) pushActivity('Refresh failed', message, 'warn')
      return sources
    } finally {
      setLoading(false)
    }
  }

  const scanRepositories = async (rootPath = discoveryRootPath, silent = false) => {
    try {
      setDiscoveryLoading(true)
      setError(null)
      const data = await fetchJson('/api/agent/sources/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath: rootPath || DEFAULT_REPO_ROOT })
      })
      const repositories = Array.isArray(data.repositories) ? data.repositories as DiscoveredRepository[] : []
      const settings = data.settings as { rootPath?: string } | undefined
      setDiscoveryRootPath(settings?.rootPath || rootPath || DEFAULT_REPO_ROOT)
      setDiscoveredRepos(repositories)
      setDiscoveryScanned(true)
      setSelectedDiscoveredRepoPath(current => {
        if (current && repositories.some(r => r.path === current && !r.alreadyAdded)) return current
        return repositories.find(r => !r.alreadyAdded)?.path || ''
      })
      if (!silent) pushActivity('Sources scanned', `${countLabel(repositories.length, 'source')} found under ${settings?.rootPath || rootPath}.`, 'good')
      return repositories
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      pushActivity('Source scan failed', message, 'warn')
      return []
    } finally {
      setDiscoveryLoading(false)
    }
  }

  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const snapshot = readSnapshot()
    if (snapshot) {
      setSources(snapshot.sources)
      setActiveMode(snapshot.activeMode)
      setActiveSourceIds(snapshot.activeSourceIds)
      setAgentConnected(true)
      setLoading(false)
    }
    void refreshSources(Boolean(snapshot))
    void refreshAgentJobs(true)
  }, [])

  useEffect(() => {
    const hasActiveAgentJob = agentJobs.some(j => ['queued', 'running', 'paused', 'needs_confirmation'].includes(j.status))
    if (!hasActiveAgentJob) return
    const interval = window.setInterval(() => {
      void refreshAgentJobs(true)
    }, 2500)
    return () => window.clearInterval(interval)
  }, [agentJobs])

  useEffect(() => {
    if (!showAddModal) return
    void scanRepositories(discoveryRootPath, true)
  }, [showAddModal])

  useEffect(() => {
    if (!showAddModal && !mobileNavigationOpen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showAddModal) closeAddSource()
      if (mobileNavigationOpen) closeMobileNavigation()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [showAddModal, mobileNavigationOpen])

  useEffect(() => {
    if (!showAddModal) return
    const firstFocusable = addSourceDialogRef.current?.querySelector<HTMLElement>('select, button, input, [tabindex]:not([tabindex="-1"])')
    firstFocusable?.focus()
  }, [showAddModal])

  useEffect(() => {
    if (!mobileNavigationOpen) return
    const dialog = document.querySelector<HTMLElement>('[aria-label="Dashboard navigation"]')
    const firstFocusable = dialog?.querySelector<HTMLElement>('button, a, select, input, [tabindex]:not([tabindex="-1"])')
    firstFocusable?.focus()
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, a, select, input, [tabindex]:not([tabindex="-1"])')).filter(item => !item.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleTab)
    return () => document.removeEventListener('keydown', handleTab)
  }, [mobileNavigationOpen])

  useEffect(() => {
    if (!selectedDiscoveredRepo) return
    setSourcePath(selectedDiscoveredRepo.path)
    setSourceLabel(selectedDiscoveredRepo.label)
    setSourceId(selectedDiscoveredRepo.id)
  }, [selectedDiscoveredRepo])

  const mutate = async (label: string, source: KnowledgeSource | null, url: string, payload: Record<string, unknown>, successDetail: string) => {
    try {
      setBusySourceId(source?.id || 'new-source')
      setError(null)
      setNotice(null)
      await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      setNotice(successDetail)
      pushActivity(label, successDetail, 'good')
      await refreshSources(true)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      pushActivity(`${label} failed`, message, 'bad')
      return false
    } finally {
      setBusySourceId(null)
    }
  }

  const setContextMode = async (mode: ActiveSourcesMode) => {
    const enabledIds = enabledSources.map(source => source.id)
    const existingActive = activeSourceIds.filter(id => enabledIds.includes(id))
    const nextIds = mode === 'single'
      ? [existingActive[0] || enabledIds[0]].filter(Boolean)
      : mode === 'multi'
        ? (existingActive.length > 1 ? existingActive : enabledIds.slice(0, 2))
        : enabledIds
    await mutate(
      'Context updated',
      null,
      '/api/agent/active-sources',
      { mode, activeSourceIds: nextIds },
      mode === 'all' ? 'All enabled sources are active.' : `${nextIds.length} ${nextIds.length === 1 ? 'source is' : 'sources are'} active.`
    )
  }

  const updateWriteMode = async (nextMode: WriteMode) => {
    try {
      setError(null)
      await fetchJson('/api/agent/write-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writeMode: nextMode })
      })
      setWriteMode(nextMode)
      setNotice(`Authority set to ${getAuthorityLabel(nextMode)}.`)
      pushActivity('Authority updated', `New goals use ${getAuthorityLabel(nextMode)}.`, 'good')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      pushActivity('Authority update failed', message, 'bad')
    }
  }

  const toggleActive = async (source: KnowledgeSource) => {
    const branchGroup = branchGroupFor(source, true)
    const groupIds = new Set(branchGroup.map(item => item.id))
    const groupActive = branchGroup.some(item => activeSourceIds.includes(item.id))
    const next = groupActive
      ? activeSourceIds.filter(id => !groupIds.has(id))
      : Array.from(new Set([...activeSourceIds, ...branchGroup.map(item => item.id)]))
    if (next.length === 0) {
      const message = 'At least one source must stay active. Activate another repo before disconnecting this one.'
      setError(message)
      pushActivity('Deactivate skipped', message, 'warn')
      return
    }
    const mode: ActiveSourcesMode = next.length > 1 ? 'multi' : 'single'
    const detail = branchGroup.length > 1
      ? `${source.label} ${groupActive ? 'disconnected' : 'connected'} with ${countLabel(branchGroup.length, 'branch')}.`
      : `${source.label} ${groupActive ? 'disconnected' : 'connected'} to this conversation.`
    await mutate(
      groupActive ? 'Deactivated' : 'Activated',
      source,
      '/api/agent/active-sources',
      { mode, activeSourceIds: next },
      detail
    )
  }

  const toggleEnabled = async (source: KnowledgeSource) => {
    const branchGroup = branchGroupFor(source)
    const detail = branchGroup.length > 1
      ? `${source.label} ${source.enabled ? 'disabled' : 'enabled'} with ${countLabel(branchGroup.length, 'branch')}.`
      : `${source.label} ${source.enabled ? 'disabled' : 'enabled'}.`
    await mutate(
      source.enabled ? 'Disabled' : 'Enabled',
      source,
      '/api/agent/sources/toggle',
      { sourceId: source.id, enabled: !source.enabled },
      detail
    )
  }

  const reindexSource = async (source: KnowledgeSource) => {
    const started = await mutate('Re-index started', source, '/api/agent/sources/reindex', { sourceId: source.id }, `${source.label} is re-indexing.`)
    if (!started) return
    const startedAt = Date.now()
    while (Date.now() - startedAt < 60_000) {
      await new Promise(resolve => window.setTimeout(resolve, 1500))
      const nextSources = await refreshSources(true)
      const current = nextSources.find(item => item.id === source.id)
      if (current && terminalStatuses.has(current.indexStatus || 'unknown')) {
        pushActivity('Re-index complete', `${current.label} · ${current.indexStatus}`, current.indexStatus === 'failed' ? 'bad' : 'good')
        return
      }
    }
    setNotice(`${source.label} is still indexing. The dashboard will show the new state on refresh.`)
  }

  const removeSource = async (source: KnowledgeSource) => {
    const confirmed = window.confirm(`Remove ${source.label} from Mastermind?`)
    if (!confirmed) return
    await mutate('Removed', source, '/api/agent/sources/remove', { sourceId: source.id }, `${source.label} removed.`)
  }

  const addSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selectedRepo = selectedDiscoveredRepo || discoveredRepos.find(r => r.path === sourcePath)
    const path = (selectedRepo?.path || sourcePath).trim()
    if (!path) {
      setError('Select a discovered repository first.')
      return
    }
    const label = selectedRepo?.label || sourceLabel.trim()
    const id = selectedRepo?.id || sourceId.trim()
    const ok = await mutate('Added', null, '/api/agent/sources/add', {
      path,
      label: label || undefined,
      id: id || undefined
    }, `${label || id || path} added.`)
    if (ok) {
      setSourcePath('')
      setSourceLabel('')
      setSourceId('')
      setSelectedDiscoveredRepoPath('')
      closeAddSource()
      void scanRepositories(discoveryRootPath, true)
    }
  }

  const currentSectionLabel = activeSection === 'goal-run' ? 'Goal / Run' : activeSection[0].toUpperCase() + activeSection.slice(1)
  const systemHealth = getSystemHealth(agentConnected, Boolean(error))
  const navigation = (
    <DashboardRail
      activeSection={activeSection}
      sources={sources}
      selectedSourceId={selectedSourceId}
      onSelectSection={section => { setActiveSection(section); closeMobileNavigation() }}
      onSelectSource={selectSource}
    />
  )
  const mobileNavigation = mobileNavigationOpen ? (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-slate-950/30" onClick={closeMobileNavigation} />
      <div className="relative h-full" role="dialog" aria-modal="true" aria-label="Dashboard navigation">
        <DashboardRail
          activeSection={activeSection}
          sources={sources}
          selectedSourceId={selectedSourceId}
          onSelectSection={section => { setActiveSection(section); closeMobileNavigation() }}
          onSelectSource={selectSource}
          compact
        />
      </div>
    </div>
  ) : null

  return (
    <main className="min-h-screen bg-mm-canvas text-mm-text font-[-apple-system,BlinkMacSystemFont,'Inter',sans-serif]">
      <div className="flex min-h-screen flex-col lg:h-screen">
        <DashboardTopBar
          currentSectionLabel={currentSectionLabel}
          systemHealth={systemHealth}
          loading={loading}
          statusText={activeSection === 'overview' ? null : error}
          theme={theme === 'dark' ? 'dark' : 'light'}
          onToggleTheme={cycleTheme}
          onRefresh={() => refreshSources(false)}
        >
          <DashboardIconButton
            ref={mobileMenuButtonRef}
            type="button"
            onClick={() => setMobileNavigationOpen(true)}
            label="Open dashboard navigation"
            className="lg:hidden"
          >
            {mobileNavigationOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
          </DashboardIconButton>
          <DashboardButton type="button" variant="primary" onClick={openAddSource} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Add source</span>
            <span className="sm:hidden">Add</span>
          </DashboardButton>
        </DashboardTopBar>

        <DashboardShell mobileNavigation={mobileNavigation}>
          {navigation}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
            {(notice || (error && activeSection !== 'overview')) && (
              <div className="shrink-0 border-b border-mm-border px-4 py-2 sm:px-6" role="status">
                {notice && <p className="text-xs text-emerald-700 dark:text-emerald-300">{notice}</p>}
                {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
              </div>
            )}

            {activeSection === 'overview' ? (
              <DashboardFoundationView
                section={activeSection}
                systemHealth={systemHealth}
                sources={sources}
                activeSources={activeSources}
                writeMode={writeMode}
                activity={activity}
                jobs={agentJobs}
                loading={loading}
                agentConnected={agentConnected}
                error={error}
                onSelectSources={() => setActiveSection('sources')}
                onSelectGoal={() => setActiveSection('goal-run')}
                onSelectActivity={() => setActiveSection('activity')}
                onSelectSettings={() => setActiveSection('settings')}
                onRefresh={() => { void refreshSources(false) }}
              />
            ) : (
              <WorkflowSurface
                section={activeSection}
                systemHealth={systemHealth}
                sources={sources}
                activeSources={activeSources}
                writeMode={writeMode}
                activeMode={activeMode}
                activity={activity}
                jobs={agentJobs}
                loading={loading}
                agentConnected={agentConnected}
                error={error}
                selectedSourceId={selectedSourceId}
                busySourceId={busySourceId}
                busyJobId={busyJobId}
                onOpenAddSource={openAddSource}
                onSelectSources={() => setActiveSection('sources')}
                onSelectGoal={() => setActiveSection('goal-run')}
                onSelectActivity={() => setActiveSection('activity')}
                onSelectSettings={() => setActiveSection('settings')}
                onToggleActive={source => { void toggleActive(source) }}
                onToggleEnabled={source => { void toggleEnabled(source) }}
                onReindex={source => { void reindexSource(source) }}
                onRemove={source => { void removeSource(source) }}
                onControlJob={(job, action) => { void controlAgentJob(job, action) }}
                onSetContextMode={mode => { void setContextMode(mode) }}
                onSetWriteMode={mode => { void updateWriteMode(mode) }}
                onRefresh={() => { void refreshSources(false) }}
              />
            )}

            <div className="shrink-0 border-t border-mm-border bg-mm-surface p-4 xl:hidden dark:border-slate-800 dark:bg-slate-950/90">
              <ActiveContextPanel
                activeMode={activeMode}
                writeMode={writeMode}
                activeSources={activeSources}
                sourceCount={sources.length}
                onSetMode={setContextMode}
                onSetWriteMode={updateWriteMode}
              />
            </div>

          </div>

          {/* Persistent context inspector; workflow evidence belongs in the active surface. */}
          <aside className="hidden min-h-0 overflow-y-auto border-l border-mm-border bg-mm-surface p-4 dark:border-slate-800 dark:bg-slate-950/90 xl:block">
            <ActiveContextPanel
              activeMode={activeMode}
              writeMode={writeMode}
              activeSources={activeSources}
              sourceCount={sources.length}
              onSetMode={setContextMode}
              onSetWriteMode={updateWriteMode}
            />
          </aside>
        </DashboardShell>
      </div>

      {/* Add repo modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) closeAddSource() }}>
          <div ref={addSourceDialogRef} role="dialog" aria-modal="true" aria-labelledby="add-source-title" aria-describedby="add-source-description" className="w-full max-w-md rounded-lg border border-mm-border bg-mm-surface p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between">
              <h2 id="add-source-title" className="text-sm font-semibold">Add source</h2>
              <button type="button" aria-label="Close add source dialog" onClick={closeAddSource} className="min-h-9 min-w-9 rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus dark:hover:bg-gray-800 dark:hover:text-gray-300">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <p id="add-source-description" className="mt-2 text-xs leading-5 text-mm-muted">Choose an existing configured repository or folder. Mastermind will prepare it before it becomes available for grounded work.</p>
            <form onSubmit={addSource} className="mt-4 space-y-3">
              <div>
                <label htmlFor="add-source-select" className="mb-1 block text-[11px] font-medium text-gray-500 dark:text-gray-400">Source</label>
                <select
                  id="add-source-select"
                  autoFocus
                  value={selectedDiscoveredRepoPath}
                  onClick={() => { if (discoveredRepos.length === 0 && !discoveryLoading) scanRepositories(discoveryRootPath, true) }}
                  onChange={e => setSelectedDiscoveredRepoPath(e.target.value)}
                  disabled={busySourceId === 'new-source'}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:focus:ring-gray-700"
                >
                  <option value="">{discoveryLoading ? 'Scanning...' : discoveryScanned ? 'Select a repository' : 'Click to scan'}</option>
                  {discoveredRepos.map(repo => (
                    <option key={repo.path} value={repo.path} disabled={repo.alreadyAdded}>
                      {repo.account} / {repo.label}{repo.branchName ? ` [${repo.branchName}]` : ''}{repo.isGitWorktree ? ' · worktree' : ''}{repo.alreadyAdded ? ' (added)' : ''}
                    </option>
                  ))}
                </select>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="truncate font-mono">{sourcePath || discoveryRootPath}</span>
                  <span>{availableDiscoveredRepos.length} available</span>
                  <button type="button" onClick={() => scanRepositories(discoveryRootPath, false)} disabled={discoveryLoading} className="font-medium text-gray-600 hover:underline disabled:opacity-50 dark:text-gray-300">
                    Rescan
                  </button>
                </div>
              </div>
              {selectedDiscoveredRepo && (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-800">
                  <span className="font-medium">{selectedDiscoveredRepo.label}</span>
                  {selectedDiscoveredRepo.branchName && <span className="ml-2 font-mono text-sky-500">{selectedDiscoveredRepo.branchName}</span>}
                  {selectedDiscoveredRepo.availableBranches && selectedDiscoveredRepo.availableBranches.length > 0 && (
                    <span className="ml-2 text-gray-400">{countLabel(selectedDiscoveredRepo.availableBranches.length, 'branch')}</span>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={closeAddSource} className="min-h-9 rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus dark:text-gray-300 dark:hover:bg-gray-800">
                  Cancel
                </button>
                <button type="submit" disabled={busySourceId === 'new-source' || !sourcePath || Boolean(selectedDiscoveredRepo?.alreadyAdded)} className="min-h-9 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">
                  {busySourceId === 'new-source' ? 'Adding...' : 'Add source'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

function workStatusLabel(status: string): string {
  switch (status) {
    case 'queued':
    case 'running':
      return 'Working'
    case 'needs_confirmation':
      return 'Waiting for approval'
    case 'paused':
      return 'Blocked'
    case 'blocked':
      return 'Blocked'
    case 'failed':
      return 'Failed'
    case 'completed':
      return 'Complete'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Working'
  }
}

function StatusPill({ children, tone }: { children: string; tone: StatusTone }) {
  const colors: Record<StatusTone, string> = {
    neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    good: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    warn: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
    bad: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
  }
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[tone]}`}>{children}</span>
}

function DropdownItem({ children, onClick, disabled, danger }: { children: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="menuitem"
      className={`w-full px-3 py-1.5 text-left text-xs transition disabled:opacity-40 ${danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}`}
    >
      {children}
    </button>
  )
}

function ActiveRunObservabilityPanel({ jobs }: { jobs: AgentDashboardJob[] }) {
  type AgentPacketSummary = {
    packetId: string
    runId: string
    taskId: string
    sourceId: string
    status: string
    exactPaths: string[]
    updatedAt: string
    completedSteps: number
    failedStep?: number
    rolledBack: boolean
    validation: Array<{
      commandKind: string
      status: string
      exitCode: number | null
      durationMs: number
    }>
    commitHash?: string
    errorCodes: string[]
  }

  const activeJob = jobs.find(job => ['queued', 'running', 'needs_confirmation', 'paused', 'blocked'].includes(job.status)) || jobs[0]
  if (!activeJob) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
        No active run observability data.
      </div>
    )
  }

  const observedJob = activeJob as AgentDashboardJob & { packets?: AgentPacketSummary[] }
  const latestPacket = observedJob.packets?.[0]
  const projection = activeJob.compactStatus
  const updatedLabel = activeJob.updatedAt
    ? new Date(activeJob.updatedAt).toLocaleString()
    : 'Unknown'
  const progressLabel = (item: AgentDashboardJob['compactStatus']['overall']) => item.percent === undefined ? '—' : `${item.percent}%`

  return (
    <section className="rounded-lg border border-gray-200 bg-white px-3 py-3 text-xs shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Active run</p>
          <p className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{workStatusLabel(activeJob.status)}</p>
        </div>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {progressLabel(projection.overall)}{projection.deltaCount > 0 ? ` · +${projection.deltaCount} task${projection.deltaCount === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Current position</p>
          <p className="mt-0.5 text-gray-700 dark:text-gray-200">{projection.currentPosition}</p>
        </div>

        <div className="grid gap-1.5" aria-label="Run progress">
          {[['Run overall', projection.overall], ['Run phase', projection.phase], ['Task', projection.task]].map(([label, item]) => {
            const progressItem = item as AgentDashboardJob['compactStatus']['overall']
            return (
              <div key={label as string} className="grid grid-cols-[3.25rem_minmax(0,1fr)_3rem] items-center gap-2 text-[10px]">
                <span className="uppercase tracking-wide text-gray-400">{label as string}</span>
                <span className="truncate font-mono text-gray-600 dark:text-gray-300" aria-label={progressItem.accessibleLabel}>{progressItem.bar}</span>
                <span className="text-right text-gray-600 dark:text-gray-300">{progressLabel(progressItem)}</span>
              </div>
            )
          })}
        </div>

        {latestPacket && (
          <details className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800/70">
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus">Technical evidence</summary>
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-gray-500">Packet status</span>
                <span className="font-mono text-[10px] text-gray-500">{latestPacket.status}</span>
              </div>
              <p className="mt-1 truncate font-mono text-[10px] text-gray-600 dark:text-gray-300">{latestPacket.packetId}</p>
              <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                {latestPacket.completedSteps} steps{latestPacket.failedStep !== undefined ? ` · failed at ${latestPacket.failedStep}` : ''}{latestPacket.rolledBack ? ' · rolled back' : ''}
              </p>
              {latestPacket.validation.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {latestPacket.validation.map(result => (
                    <div key={`${latestPacket.packetId}-${result.commandKind}`} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate text-gray-500 dark:text-gray-400">{result.commandKind}</span>
                      <span className={result.status === 'completed' || result.exitCode === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                        {result.status}{result.exitCode === null ? '' : ` (${result.exitCode})`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {latestPacket.commitHash && (
                <p className="mt-1.5 truncate font-mono text-[10px] text-emerald-600 dark:text-emerald-400">Commit {latestPacket.commitHash}</p>
              )}
              {latestPacket.errorCodes.length > 0 && (
                <p className="mt-1.5 text-[10px] text-red-600 dark:text-red-400">{latestPacket.errorCodes.join(', ')}</p>
              )}
            </div>
          </details>
        )}

        {projection.blocker && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-amber-500">Blocker</p>
            <p className="mt-0.5 text-amber-700 dark:text-amber-300">{projection.blocker}</p>
          </div>
        )}

        {projection.nextAction && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400">Next action</p>
            <p className="mt-0.5 text-gray-700 dark:text-gray-200">{projection.nextAction}</p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
          <div>
            <dt className="uppercase tracking-wide">Source</dt>
            <dd className="mt-0.5 truncate font-mono text-gray-700 dark:text-gray-300">{projection.repository}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide">Updated</dt>
            <dd className="mt-0.5 text-gray-700 dark:text-gray-300">{updatedLabel}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

function AgentJobCard({ job, busyJobId, onControl }: { job: AgentDashboardJob; busyJobId: string | null; onControl: (job: AgentDashboardJob, action: 'pause' | 'resume' | 'cancel') => void }) {
  const projection = job.compactStatus
  const progressLabel = (item: AgentDashboardJob['compactStatus']['overall']) => item.percent === undefined ? '—' : `${item.percent}%`
  const tone: StatusTone = job.status === 'failed' || job.status === 'blocked' ? 'bad' : job.status === 'needs_confirmation' || job.status === 'paused' ? 'warn' : job.status === 'completed' ? 'good' : 'neutral'
  return (
    <div className={`rounded-lg px-2.5 py-2 text-xs ${toneBg(tone)}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium">{projection.repository}: {workStatusLabel(job.status)}</span>
        <span className="font-mono text-[10px] opacity-60">{progressLabel(projection.overall)}{projection.deltaCount > 0 ? ` · +${projection.deltaCount} task${projection.deltaCount === 1 ? '' : 's'}` : ''}</span>
      </div>
      <p className="mt-0.5 truncate opacity-75">{projection.currentPosition}</p>
      <p className="mt-1 truncate font-mono text-[10px] opacity-70" aria-label={projection.overall.accessibleLabel}>
        {projection.overall.bar} {progressLabel(projection.overall)}
      </p>
      {projection.blocker && (
        <p className="mt-1 opacity-75">{projection.blocker}</p>
      )}
      {!projection.blocker && projection.nextAction && (
        <p className="mt-1 truncate opacity-75">Next: {projection.nextAction}</p>
      )}
      <div className="mt-1.5 flex gap-1">
        <MiniButton onClick={() => onControl(job, 'pause')} disabled={busyJobId === job.id || !['queued', 'running'].includes(job.status)}>Pause</MiniButton>
        <MiniButton onClick={() => onControl(job, 'resume')} disabled={busyJobId === job.id || job.status !== 'paused'}>Resume</MiniButton>
        <MiniButton onClick={() => onControl(job, 'cancel')} disabled={busyJobId === job.id || ['completed', 'failed', 'cancelled'].includes(job.status)} danger>Cancel</MiniButton>
      </div>
    </div>
  )
}

function MiniButton({ children, onClick, disabled, danger }: { children: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition disabled:opacity-30 ${danger ? 'text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/30' : 'text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700'}`}
    >
      {children}
    </button>
  )
}

function toneBg(tone: StatusTone): string {
  const map: Record<StatusTone, string> = {
    neutral: 'bg-gray-50 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300',
    good: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
    warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
    bad: 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300'
  }
  return map[tone]
}
