import { useAppStore } from '@/store/index'
import { selectFrontTab } from '@/store/slices/tabs/active-tab-selection'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import {
  createPairedRevealedTabWait,
  type StructuredSessionOpenSelection
} from './wait-for-structured-session-tab'

// Matches the open's other host round-trips; past it the open reports that the tab never appeared.
const PAIRED_REVEALED_TAB_WAIT_MS = 5_000

type OpenTarget = { sessionId: string; worktreeId: string }

/** What this window shows: its view, workspace, host and front tab. */
export function desktopSelectionKey(): string {
  const state = useAppStore.getState()
  const workspace = state.activeWorkspaceKey ?? state.activeWorktreeId
  const front = selectFrontTab(state)
  return [state.activeView, workspace, state.activeWorkspaceExecutionHostId, front?.id].join('\0')
}

function frontSelection(target: OpenTarget): StructuredSessionOpenSelection {
  const front = selectFrontTab(useAppStore.getState())
  return {
    key: desktopSelectionKey(),
    showsTarget:
      front?.contentType === 'agent-session' &&
      front.entityId === target.sessionId &&
      front.worktreeId === target.worktreeId
  }
}

/** One desktop open's wait for a paired server's revealed tab, bound to this window's store. */
export function pairedRevealedTabWait(
  owner: RuntimeClientTarget,
  tabs: (target: OpenTarget, owner: RuntimeClientTarget) => readonly { sessionId: string }[],
  request: unknown
): ReturnType<typeof createPairedRevealedTabWait> {
  return createPairedRevealedTabWait({
    paired: owner.kind === 'environment',
    request,
    hasTab: (target) => tabs(target, owner).some((row) => row.sessionId === target.sessionId),
    selection: frontSelection,
    subscribe: (listener) => useAppStore.subscribe(listener),
    timeoutMs: PAIRED_REVEALED_TAB_WAIT_MS
  })
}
