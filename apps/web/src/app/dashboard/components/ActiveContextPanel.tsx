import type { ActiveSourcesMode, KnowledgeSource, WriteMode } from '@mastermind/shared'

import { DashboardButton } from './ui/DashboardButton'
import { DashboardMetaRow } from './ui/DashboardMetaRow'
import { DashboardPanel } from './ui/DashboardPanel'
import { DashboardSectionHeader } from './ui/DashboardSectionHeader'
import { DashboardStatusBadge } from './ui/DashboardStatusBadge'
import { getAuthorityLabel, getSourceState, getSourceStateLabel, getSourceStateTone } from '../status'

type ActiveContextPanelProps = {
  activeMode: ActiveSourcesMode
  writeMode: WriteMode
  activeSources: KnowledgeSource[]
  sourceCount: number
  onSetMode: (mode: ActiveSourcesMode) => void
  onSetWriteMode: (mode: WriteMode) => void
}

const modeButtons: Array<{ id: ActiveSourcesMode; label: string }> = [
  { id: 'single', label: 'Single' },
  { id: 'multi', label: 'Multi' },
  { id: 'all', label: 'All' }
]

const writeButtons: Array<{ id: WriteMode; label: string }> = [
  { id: 'readOnly', label: 'Read only' },
  { id: 'artifactsOnly', label: 'Artifacts only' },
  { id: 'safeWrites', label: 'Safe writes' }
]

export function ActiveContextPanel({
  activeMode,
  writeMode,
  activeSources,
  sourceCount,
  onSetMode,
  onSetWriteMode
}: ActiveContextPanelProps) {
  return (
    <div className="space-y-3">
      <DashboardPanel variant="flat" className="p-4">
        <DashboardSectionHeader
          eyebrow="Active context"
          title="Current workspace"
          detail="The source scope and authority used for the next goal."
        />
        <div className="mt-4 space-y-2">
          {activeSources.length > 0 ? activeSources.map(source => {
            const state = getSourceState(source)
            return (
              <div key={source.id} className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-mm-subtle/70 px-3 py-2 dark:bg-slate-900/60">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-mm-text">{source.label}</p>
                  <p className="truncate font-mono-ui text-[10px] text-mm-muted">{source.branchName || source.path}</p>
                </div>
                <DashboardStatusBadge label={getSourceStateLabel(state)} tone={getSourceStateTone(state)} />
              </div>
            )
          }) : (
            <p className="rounded-md border border-dashed border-mm-border px-3 py-2 text-[12px] text-mm-muted">No active source selected.</p>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {modeButtons.map(button => {
            const active = activeMode === button.id
            return (
              <DashboardButton
                key={button.id}
                type="button"
                onClick={() => onSetMode(button.id)}
                variant={active ? 'primary' : 'secondary'}
                className="w-full justify-center text-[12px]"
              >
                {button.label}
              </DashboardButton>
            )
          })}
        </div>
        <div className="mt-3">
          <DashboardMetaRow
            label="Scope"
            value={activeSources.length > 0 ? `${activeSources.length} of ${sourceCount} active` : 'No source'}
            className="text-[12px]"
          />
          <DashboardMetaRow label="Authority" value={getAuthorityLabel(writeMode)} className="mt-2 text-[12px]" />
        </div>
      </DashboardPanel>

      <DashboardPanel variant="flat" className="p-4">
        <DashboardSectionHeader eyebrow="Write" title="Write mode" />
        <div className="mt-4 grid gap-2">
          {writeButtons.map(button => {
            const active = writeMode === button.id
            return (
              <DashboardButton
                key={button.id}
                type="button"
                onClick={() => onSetWriteMode(button.id)}
                variant={active ? 'primary' : 'secondary'}
                className="w-full justify-start px-3 text-[12px]"
              >
                {button.label}
              </DashboardButton>
            )
          })}
        </div>
      </DashboardPanel>
    </div>
  )
}
