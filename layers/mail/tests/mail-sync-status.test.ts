import { describe, expect, it, vi } from 'vitest'
import { resolveIndexTotal } from '../server/utils/mail-sync'

describe('resolveIndexTotal', () => {
  it('uses a stored total without asking the provider', async () => {
    const load = vi.fn(async () => 42)

    await expect(resolveIndexTotal(25_012, load)).resolves.toBe(25_012)
    expect(load).not.toHaveBeenCalled()
  })

  it('loads the total when the stored progress has none', async () => {
    const load = vi.fn(async () => 11_090)

    await expect(resolveIndexTotal(undefined, load)).resolves.toBe(11_090)
    await expect(resolveIndexTotal(null, load)).resolves.toBe(11_090)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('answers without a total when the loader fails', async () => {
    await expect(resolveIndexTotal(undefined, async () => {
      throw new Error('mail server offline')
    })).resolves.toBeNull()
  })

  it('answers without a total when the loader is slower than the timeout', async () => {
    await expect(resolveIndexTotal(undefined, () => new Promise<number>(() => {}), 5)).resolves.toBeNull()
  })
})
