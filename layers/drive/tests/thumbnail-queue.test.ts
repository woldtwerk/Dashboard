import { describe, expect, it } from 'vitest'
import { createThumbnailQueue } from '../app/utils/thumbnail-queue'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createThumbnailQueue', () => {
  it('grants at most `limit` slots at a time and hands the next one on release', async () => {
    const queue = createThumbnailQueue(2)
    const first = queue.acquire()
    const second = queue.acquire()
    const third = queue.acquire()

    const releaseFirst = await first.promise
    const releaseSecond = await second.promise

    let thirdGranted = false
    third.promise.then(() => {
      thirdGranted = true
    })
    await flush()
    expect(thirdGranted).toBe(false)

    releaseFirst()
    await flush()
    expect(thirdGranted).toBe(true)

    releaseSecond()
    ;(await third.promise)()
  })

  it('never grants a request cancelled before a slot was free', async () => {
    const queue = createThumbnailQueue(1)
    const held = queue.acquire()
    const release = await held.promise

    const waiting = queue.acquire()
    let granted = false
    waiting.promise.then(() => {
      granted = true
    })
    waiting.cancel()

    release()
    await flush()
    expect(granted).toBe(false)
  })
})
