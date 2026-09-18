import type { KnowledgeSource, ActiveSourcesMode, WriteMode } from '@mastermind/shared'
import type { StatusTone } from './status'

export type DashboardSection = 'overview' | 'sources' | 'goal-run' | 'activity' | 'settings'

export type DashboardActivityTone = 'neutral' | 'good' | 'warn' | 'bad'

export type DashboardActivityEvent = {
  id: string
  type: string
  title: string
  detail: string
  timestamp: string
  tone: DashboardActivityTone
}

export type DashboardRuntimeEvent = {
  id: string
  jobId: string
  sourceId: string
  type: string
  message: string
  createdAt: string
  commandKind?: string
  status?: string
}

export type DashboardPacket = {
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

export type DashboardJob = {
  id: string
  sourceId: string
  status: string
  currentIteration: number
  maxIterations: number
  completedTaskCount: number
  totalTaskCount: number
  updatedAt?: string
  goal?: string
  summary?: string
  handoffPath?: string
  autoCommit?: boolean
  autoPush?: boolean
  requiresConfirmation?: boolean
  confirmationReason?: string
  blockedReason?: string
  lastKnownGitStatus?: string
  nextActions?: string[]
  activeTask?: {
    id?: string
    title: string
    phaseTitle: string
    status: string
    acceptanceCriteria?: string[]
    validation?: string[]
  }
  roadmapSummary?: Array<{
    id: string
    title: string
    status: string
    completedTasks: number
    totalTasks: number
  }>
  compactStatus: {
    repository: string
    runId: string
    status: string
    phaseTitle?: string
    taskTitle?: string
    overall: DashboardProgress
    phase: DashboardProgress
    task: DashboardProgress
    deltaCount: number
    deltaPercent: number
    currentPosition: string
    blocker?: string
    nextAction?: string
    executionProfile: { engine: 'direct'; autonomy: 'supervised' | 'hands_off_safe' }
    text: string
    narrowText: string
  }
  packets?: DashboardPacket[]
}

export type DashboardProgress = {
  percent?: number
  numerator: number
  denominator: number
  bar: string
  accessibleLabel: string
  confidence: 'exact' | 'unknown'
}

export type DashboardActivityLine = {
  id: string
  label: string
  detail: string
  tone: StatusTone
  timestamp?: string
}

export type DashboardSourceSnapshot = {
  sources: KnowledgeSource[]
  activeMode: ActiveSourcesMode
  activeSourceIds: string[]
  writeMode: WriteMode
  savedAt: string
}

export type DashboardPlanTaskStatus = 'pending' | 'active' | 'done' | 'blocked'

export type DashboardPlanTask = {
  id: string
  title: string
  detail: string
  status: DashboardPlanTaskStatus
}

export type DashboardLocalPlan = {
  id: string
  title: string
  summary: string
  sourceId: string | null
  createdAt: string
  updatedAt: string
  tasks: DashboardPlanTask[]
}
