import { describe, expect, it } from 'vitest'
import { createSourceLifecycle } from '../app/utils/domain-event-source'

function setup(graceMs = 5000) {
  const events: string[] = []
  const timers = new Map<number, { callback: () => void, ms: number }>()
  let nextId = 1

  const lifecycle = createSourceLifecycle({
    open: () => events.push('open'),
    close: () => events.push('close'),
    onReconnect: () => events.push('reconnect'),
    setTimer: (callback, ms) => {
      const id = nextId++
      timers.set(id, { callback, ms })
      return id
    },
    clearTimer: id => timers.delete(id as number),
    graceMs
  })

  /** Runs every pending timer, as the event loop eventually would. */
  const fireTimers = () => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id)
      timer.callback()
    }
  }

  return { lifecycle, events, timers, fireTimers }
}

describe('createSourceLifecycle', () => {
  it('opens with the first subscriber', () => {
    const { lifecycle, events } = setup()

    lifecycle.subscribe()

    expect(events).toEqual(['open'])
  })

  it('closes only after the grace time when the last subscriber leaves', () => {
    const { lifecycle, events, timers, fireTimers } = setup(5000)

    lifecycle.subscribe()
    lifecycle.subscribe()
    lifecycle.unsubscribe()
    expect(events).toEqual(['open'])

    lifecycle.unsubscribe()
    expect([...timers.values()].map(timer => timer.ms)).toEqual([5000])

    fireTimers()
    expect(events).toEqual(['open', 'close'])
  })

  it('cancels the grace close when a subscriber arrives in time', () => {
    const { lifecycle, events, timers, fireTimers } = setup()

    lifecycle.subscribe()
    lifecycle.unsubscribe()
    lifecycle.subscribe()

    expect(timers.size).toBe(0)
    fireTimers()
    expect(events).toEqual(['open'])
  })

  it('does not close on a stale grace timer once someone resubscribed', () => {
    const events: string[] = []
    let stale: (() => void) | undefined

    // clearTimer deliberately does nothing: the callback must guard itself
    const lifecycle = createSourceLifecycle({
      open: () => events.push('open'),
      close: () => events.push('close'),
      onReconnect: () => events.push('reconnect'),
      setTimer: (callback) => {
        stale = callback
        return 1
      },
      clearTimer: () => {}
    })

    lifecycle.subscribe()
    lifecycle.unsubscribe()
    lifecycle.subscribe()
    stale!()

    expect(events).toEqual(['open'])
  })

  it('reconnects only when an open follows an error', () => {
    const { lifecycle, events } = setup()

    lifecycle.subscribe()
    lifecycle.markOpen()
    expect(events).toEqual(['open'])

    lifecycle.markErrored()
    lifecycle.markOpen()
    expect(events).toEqual(['open', 'reconnect'])

    lifecycle.markOpen()
    expect(events).toEqual(['open', 'reconnect'])
  })

  it('reopens and refetches when the tab becomes visible again', () => {
    const { lifecycle, events } = setup()

    lifecycle.subscribe()
    lifecycle.markErrored()
    lifecycle.reconnect()
    // The reconnect already refetched; the following open must not refetch again
    lifecycle.markOpen()

    expect(events).toEqual(['open', 'open', 'reconnect'])
  })
})
