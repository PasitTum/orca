/**
 * Settles once `present()` holds, re-checked on every store change, or after `timeoutMs`.
 * A paired server's chat tab reaches this window through its workspace stream, after the reveal replied.
 */
export function waitForStructuredSessionTab(
  present: () => boolean,
  subscribe: (listener: () => void) => () => void,
  timeoutMs: number
): Promise<void> {
  if (present()) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | null = null
    const finish = (): void => {
      clearTimeout(timer)
      unsubscribe?.()
      unsubscribe = null
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    unsubscribe = subscribe(() => {
      if (present()) {
        finish()
      }
    })
    // The tab may have landed between the first check and the subscription.
    if (present()) {
      finish()
    }
  })
}

type OpenTarget = { sessionId: string; worktreeId: string }

/** What the window shows: `key` changes with any newer selection; `showsTarget` when it is this chat. */
export type StructuredSessionOpenSelection = { key: string; showsTarget: boolean }

let requestGeneration = 0
let latestRequest: unknown = null

/** Notes an open the user just asked for, and returns its identity. A repeat of a pending open
 *  (the same `key`) renews that open's claim; an open without a key is always a new one. */
export function noteDesktopOpenRequest(key?: string): unknown {
  requestGeneration++
  latestRequest = key ?? Symbol('desktop-open')
  return latestRequest
}

/** Whether no other open was asked for since `request`. */
export function isLatestDesktopOpenRequest(request: unknown): boolean {
  return latestRequest === request
}

/**
 * The wait a paired server's revealed tab needs, and whether the open is still the user's latest choice.
 * Once the wait starts, a newer open, or the window showing anything other than this chat, supersedes
 * it for good, so its late tab never takes the selection, the focus or the workspace back. Asking for
 * the same chat again renews it from what the window shows then. A local open never waits.
 */
export function createPairedRevealedTabWait(io: {
  paired: boolean
  request: unknown
  hasTab: (target: OpenTarget) => boolean
  selection: (target: OpenTarget) => StructuredSessionOpenSelection
  subscribe: (listener: () => void) => () => void
  timeoutMs: number
}): { awaitTab: (target: OpenTarget) => Promise<void>; current: () => boolean } {
  type Waited = { target: OpenTarget; key: string; generation: number; superseded: boolean }
  let waited: Waited | null = null
  const from = (target: OpenTarget): Waited => ({
    target,
    key: io.selection(target).key,
    generation: requestGeneration,
    superseded: false
  })
  const current = (): boolean => {
    if (!waited) {
      return true
    }
    if (latestRequest !== io.request) {
      return false
    }
    if (waited.generation !== requestGeneration) {
      waited = from(waited.target)
    }
    if (!waited.superseded) {
      const now = io.selection(waited.target)
      waited.superseded = !now.showsTarget && now.key !== waited.key
    }
    return !waited.superseded
  }
  return {
    awaitTab: (target) => {
      if (!io.paired) {
        return Promise.resolve()
      }
      waited = from(target)
      // Checked on every store change, so a selection that moves away and back still supersedes it.
      return waitForStructuredSessionTab(
        () => !current() || io.hasTab(target),
        io.subscribe,
        io.timeoutMs
      )
    },
    current
  }
}
