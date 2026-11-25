import { afterEach, describe, expect, it, vi } from 'vitest'
import { openStructuredAgentSession } from '../../../../../shared/agent-session/view/open-structured-agent-session'
import {
  createPairedRevealedTabWait,
  noteDesktopOpenRequest,
  waitForStructuredSessionTab
} from './wait-for-structured-session-tab'

function store(): {
  subscribe: (listener: () => void) => () => void
  emit: () => void
  size: () => number
} {
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: () => listeners.forEach((listener) => listener()),
    size: () => listeners.size
  }
}

describe('waitForStructuredSessionTab', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('settles when a store change brings the tab, and stops listening', async () => {
    const changes = store()
    let present = false
    const waiting = waitForStructuredSessionTab(() => present, changes.subscribe, 5_000)
    present = true
    changes.emit()
    await waiting
    expect(changes.size()).toBe(0)
  })

  it('settles at the timeout when the tab never arrives', async () => {
    vi.useFakeTimers()
    const changes = store()
    let settled = false
    const waiting = waitForStructuredSessionTab(() => false, changes.subscribe, 5_000).then(() => {
      settled = true
    })
    changes.emit()
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)
    await waiting
    expect(settled).toBe(true)
    expect(changes.size()).toBe(0)
  })
})

describe('createPairedRevealedTabWait through the shared open', () => {
  const target = { sessionId: 'chat-a', worktreeId: 'folder:bot-home' }
  type Tab = { id: string; sessionId: string }
  type Selection = { key: string; front: string | null }

  /** A paired server whose revealed tab for chat A streams in only when `deliverA` runs. */
  function pairedOpen(selection: Selection) {
    const changes = store()
    let tabs: Tab[] = []
    const activated: string[] = []
    const guard = createPairedRevealedTabWait({
      paired: true,
      request: noteDesktopOpenRequest('open chat-a'),
      hasTab: (t) => tabs.some((row) => row.sessionId === t.sessionId),
      selection: (t) => ({ key: selection.key, showsTarget: selection.front === t.sessionId }),
      subscribe: changes.subscribe,
      timeoutMs: 5_000
    })
    let waiting!: () => void
    const waitStarted = new Promise<void>((resolve) => {
      waiting = resolve
    })
    const result = openStructuredAgentSession(
      { kind: 'history', structuredSession: { ...target, workspaceId: target.worktreeId } },
      {
        locate: async () => ({ location: { kind: 'chat', ...target } }),
        tabs: () => tabs,
        refresh: async () => {},
        activate: (tab) => {
          activated.push(tab.sessionId)
          selection.front = tab.sessionId
          return true
        },
        reveal: async () => target,
        awaitTab: (t) => {
          const wait = guard.awaitTab(t)
          waiting()
          return wait
        },
        current: guard.current
      }
    )
    const deliverA = (): void => {
      tabs = [{ id: 'agent-session:chat-a', sessionId: 'chat-a' }]
      changes.emit()
    }
    /** The user's selection changes, as any store write would announce it. */
    const select = (next: Selection): void => {
      selection.key = next.key
      selection.front = next.front
      changes.emit()
    }
    return { result, waitStarted, deliverA, select, activated }
  }

  it('opens chat A when nothing else was selected while it waited', async () => {
    const open = pairedOpen({ key: 'workspace-a|tab-1', front: 'tab-1' })
    await open.waitStarted
    open.deliverA()
    await expect(open.result).resolves.toMatchObject({ kind: 'opened' })
    expect(open.activated).toEqual(['chat-a'])
  })

  it('leaves a chat B the user selected during the wait in front', async () => {
    const selection: Selection = { key: 'workspace-a|tab-1', front: 'tab-1' }
    const open = pairedOpen(selection)
    await open.waitStarted
    open.select({ key: 'workspace-b|chat-b', front: 'chat-b' })
    open.deliverA()
    await expect(open.result).resolves.toEqual({ kind: 'superseded' })
    expect(open.activated).toEqual([])
    expect(selection.front).toBe('chat-b')
  })

  it('stays superseded when the selection moves away and comes back before A arrives', async () => {
    const open = pairedOpen({ key: 'workspace-a|tab-1', front: 'tab-1' })
    await open.waitStarted
    open.select({ key: 'workspace-b|chat-b', front: 'chat-b' })
    open.select({ key: 'workspace-a|tab-1', front: 'tab-1' })
    open.deliverA()
    await expect(open.result).resolves.toEqual({ kind: 'superseded' })
    expect(open.activated).toEqual([])
  })

  it('yields to a newer open even before the selection changes', async () => {
    const open = pairedOpen({ key: 'workspace-a|tab-1', front: 'tab-1' })
    await open.waitStarted
    noteDesktopOpenRequest('open chat-b')
    open.deliverA()
    await expect(open.result).resolves.toEqual({ kind: 'superseded' })
    expect(open.activated).toEqual([])
  })

  it('opens chat A when it is asked for again after a newer open', async () => {
    const open = pairedOpen({ key: 'workspace-a|tab-1', front: 'tab-1' })
    await open.waitStarted
    noteDesktopOpenRequest('open chat-b')
    // Chat B is in front now; the user asks for chat A again, joining its pending open.
    open.select({ key: 'workspace-b|chat-b', front: 'chat-b' })
    noteDesktopOpenRequest('open chat-a')
    open.deliverA()
    await expect(open.result).resolves.toMatchObject({ kind: 'opened' })
    expect(open.activated).toEqual(['chat-a'])
  })
})
