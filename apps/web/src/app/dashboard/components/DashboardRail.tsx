import type { KnowledgeSource } from '@mastermind/shared'
import { Activity, Database, LayoutDashboard, PlayCircle, Settings } from 'lucide-react'
import { getSourceState, getSourceStateLabel, getSourceStateTone } from '../status'
import type { DashboardSection } from '../types'
import { DashboardListRow } from './ui/DashboardListRow'
import { DashboardNavItem } from './ui/DashboardNavItem'
import { DashboardStatusDot } from './ui/DashboardStatusDot'

type DashboardRailProps = {
  activeSection: DashboardSection
  sources: KnowledgeSource[]
  selectedSourceId: string | null
  onSelectSection: (section: DashboardSection) => void
  onSelectSource: (sourceId: string) => void
  compact?: boolean
}

const NAV_ITEMS: { id: DashboardSection; label: string; icon: JSX.Element }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={1.8} /> },
  { id: 'sources', label: 'Sources', icon: <Database className="h-3.5 w-3.5" strokeWidth={1.8} /> },
  { id: 'goal-run', label: 'Goal / Run', icon: <PlayCircle className="h-3.5 w-3.5" strokeWidth={1.8} /> },
  { id: 'activity', label: 'Activity', icon: <Activity className="h-3.5 w-3.5" strokeWidth={1.8} /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-3.5 w-3.5" strokeWidth={1.8} /> }
]

export function DashboardRail({
  activeSection,
  sources,
  selectedSourceId,
  onSelectSection,
  onSelectSource,
  compact = false
}: DashboardRailProps) {
  const shownSources = compact ? [] : sources.slice(0, 5)

  return (
    <aside className={`min-h-0 flex-col border-r border-mm-border/80 bg-mm-surface dark:border-slate-800/80 dark:bg-slate-950/95 ${compact ? 'flex h-full w-72 shadow-xl' : 'hidden h-full lg:flex'}`}>
      <div className="shrink-0 border-b border-mm-border/70 px-3 py-3.5 dark:border-slate-800/70">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-mm-border-strong bg-mm-accent text-[11px] font-semibold text-mm-surface dark:border-slate-700 dark:bg-slate-100 dark:text-slate-900">
            M
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-mm-text dark:text-slate-50">Mastermind</div>
            <div className="text-[11px] text-mm-muted dark:text-slate-400">Local workspace</div>
          </div>
        </div>
      </div>

      <nav aria-label="Primary navigation" className="shrink-0 px-2.5 py-2.5">
        <div className="space-y-1">
          {NAV_ITEMS.map(item => {
            const isActive = activeSection === item.id
            return (
              <DashboardNavItem
                key={item.id}
                onClick={() => onSelectSection(item.id)}
                active={isActive}
                icon={item.icon}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </DashboardNavItem>
            )
          })}
        </div>
      </nav>

      {!compact && <div className="min-h-0 flex-1 px-2.5 pb-2.5">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-mm-muted dark:text-slate-400">
            Sources
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-0.5">
            {shownSources.length === 0 ? (
            <div className="rounded-md border border-dashed border-mm-border/70 bg-mm-subtle px-3 py-3 text-sm text-mm-muted dark:border-slate-800/70 dark:bg-slate-950/40 dark:text-slate-300">
                No Sources yet. Add a repository or folder in Sources.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-mm-border/70 bg-mm-surface/80 dark:border-slate-800/70 dark:bg-slate-950/40">
                {shownSources.map(source => (
                  <DashboardListRow
                    key={source.id}
                    className="px-2.5"
                    selected={selectedSourceId === source.id}
                    onClick={() => onSelectSource(source.id)}
                  >
                    <DashboardStatusDot tone={getSourceStateTone(getSourceState(source))} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-mm-text dark:text-slate-50">{source.label}</div>
                      <div className="truncate font-mono-ui text-[10px] text-mm-muted dark:text-slate-400">{source.path}</div>
                    </div>
                    <div className="shrink-0 text-right text-[10px] text-mm-muted dark:text-slate-400">{getSourceStateLabel(getSourceState(source))}</div>
                  </DashboardListRow>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>}
    </aside>
  )
}
