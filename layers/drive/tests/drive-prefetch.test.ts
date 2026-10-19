import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrivePrefetchQueue, DRIVE_PREFETCH_HOVER_MS } from '../app/utils/drive-prefetch'
import type { DrivePrefetchTarget } from '../app/utils/drive-prefetch'

const target = (path: string, service = 'svc'): DrivePrefetchTarget => ({ service, path })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function flush(times = 10) {
  for (let index = 0; index < times; index++) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createDrivePrefetchQueue', () => {
  it('runs a hover only after the intent delay', async () => {
    const load = vi.fn()
    const queue = createDrivePrefetchQueue(load)

    queue.hover(target('/a'))
    await vi.advanceTimersByTimeAsync(DRIVE_PREFETCH_HOVER_MS - 1)
    expect(load).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('cancels a hover that leaves before the delay', async () => {
    const load = vi.fn()
    const queue = createDrivePrefetchQueue(load)

    queue.hover(target('/a'))
    queue.leave(target('/a'))
    await vi.advanceTimersByTimeAsync(DRIVE_PREFETCH_HOVER_MS + 10)

    expect(load).not.toHaveBeenCalled()
  })

  it('runs a press at once and warms a folder only once while it is pending', async () => {
    const load = vi.fn()
    const queue = createDrivePrefetchQueue(load)

    queue.enqueue(target('/a'))
    queue.enqueue(target('/a'))
    queue.hover(target('/a'))
    await flush()

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('promotes a hover to an immediate load on a press', async () => {
    const load = vi.fn()
    const queue = createDrivePrefetchQueue(load)

    queue.hover(target('/a'))
    queue.enqueue(target('/a'))
    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(DRIVE_PREFETCH_HOVER_MS + 10)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps at most one load in flight and starts the next when it settles', async () => {
    const first = deferred()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(undefined)
    const queue = createDrivePrefetchQueue(load)

    queue.enqueue(target('/a'))
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    expect(queue.active).toBe(1)

    queue.enqueue(target('/b'))
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    expect(queue.waiting).toBe(1)

    first.resolve()
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(queue.waiting).toBe(0)
  })

  it('drops queued loads on a navigation but keeps the running one', async () => {
    const first = deferred()
    const load = vi.fn().mockReturnValueOnce(first.promise)
    const queue = createDrivePrefetchQueue(load)

    queue.enqueue(target('/a'))
    queue.enqueue(target('/b'))
    await flush()

    queue.cancelQueued()
    expect(queue.active).toBe(1)
    expect(queue.waiting).toBe(0)

    first.resolve()
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('starts a load again after an earlier one settled', async () => {
    const load = vi.fn()
    const queue = createDrivePrefetchQueue(load)

    queue.enqueue(target('/a'))
    await flush()
    queue.enqueue(target('/a'))
    await flush()

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('drops a pending hover on a navigation, so a later hover warms it again', async () => {
    const load = vi.fn()
    const queue = createDrivePrefetchQueue(load)

    queue.hover(target('/a'))
    queue.cancelQueued()
    await vi.advanceTimersByTimeAsync(DRIVE_PREFETCH_HOVER_MS + 10)
    expect(load).not.toHaveBeenCalled()

    queue.hover(target('/a'))
    await vi.advanceTimersByTimeAsync(DRIVE_PREFETCH_HOVER_MS)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
