import path from 'node:path'
import type { WorkbenchGoalDispatchInput } from './workbench-goal-dispatch'
import type { WorkbenchPacketPreflightResult } from './workbench-packets'

/**
 * The first automatic Codex write slice remains deliberately small, but its
 * path authority comes from the canonical Workbench packet preflight rather
 * than a Codex-specific repository prefix.
 */

export function validateGovernedCodexMutationDispatch(
  dispatch: WorkbenchGoalDispatchInput,
  admission?: { preflight?: WorkbenchPacketPreflightResult }
): { ok: true; exactPath: string } | { ok: false; code: string; message: string } {
  if (dispatch.readOnly === true) return { ok: false, code: 'CODEX_MUTATION_REQUIRES_WRITE_PACKET', message: 'Governed Codex mutation requires a non-read-only packet.' }
  if (dispatch.steps.length !== 1) return { ok: false, code: 'CODEX_MUTATION_STEP_COUNT_INVALID', message: 'The first governed Codex mutation admits exactly one write step.' }
  if (dispatch.commit?.enabled && dispatch.commit.authorized !== true) return { ok: false, code: 'CODEX_MUTATION_COMMIT_AUTHORIZATION_REQUIRED', message: 'A Workbench-authorized delegated commit is required before commit mode is enabled.' }
  if (dispatch.pushIntent === 'explicitly_authorized') return { ok: false, code: 'CODEX_MUTATION_PUSH_FORBIDDEN', message: 'The first governed Codex mutation cannot push.' }
  const step = dispatch.steps[0]
  const exactPath = path.posix.normalize(step.path.replace(/\\/g, '/'))
  const preflight = admission?.preflight
  const admittedPaths = Array.from(new Set(preflight?.exactPaths || []))
  if (!preflight?.accepted || admittedPaths.length !== 1 || admittedPaths[0] !== exactPath) return { ok: false, code: 'CODEX_MUTATION_POLICY_NOT_ADMITTED', message: 'The governed Codex mutation path must match one exact path accepted by Workbench packet preflight.' }
  if (!['overwrite', 'patch'].includes(step.type)) return { ok: false, code: 'CODEX_MUTATION_OPERATION_NOT_ADMITTED', message: 'The first governed Codex mutation admits only overwrite or patch.' }
  if (!Array.isArray(dispatch.validation) || dispatch.validation.length !== 1 || dispatch.validation[0]?.commandKind !== 'git_diff_check' || JSON.stringify(dispatch.validation[0].paths || []) !== JSON.stringify([exactPath])) {
    return { ok: false, code: 'CODEX_MUTATION_VALIDATION_REQUIRED', message: 'The first governed Codex mutation requires one exact-path git diff check.' }
  }
  if ((dispatch.reads?.length || 0) < 1 || (dispatch.commands?.length || 0) < 1) {
    return { ok: false, code: 'CODEX_MUTATION_MCP_PROOF_REQUIRED', message: 'The first governed Codex mutation requires bounded Workbench MCP context and command requests.' }
  }
  return { ok: true, exactPath }
}
