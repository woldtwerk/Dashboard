import { describe, expect, it } from 'vitest'
import type { DriveEntry } from '../shared/types/drive'
import { driveListingCacheKey, rememberDriveListing, type DriveListingRequests } from '../app/utils/drive-listing-cache'

function request(name: string): Promise<DriveEntry[]> {
  return Promise.resolve([{ name } as DriveEntry])
}

function keys(cache: DriveListingRequests): string[] {
  return [...cache.keys()]
}

describe('driveListingCacheKey', () => {
  it('keeps equal paths of different accounts apart', () => {
    expect(driveListingCacheKey('a', '/my-files')).not.toBe(driveListingCacheKey('b', '/my-files'))
    expect(driveListingCacheKey('a', '/my-files')).toBe(driveListingCacheKey('a', '/my-files'))
  })
})

describe('rememberDriveListing', () => {
  it('returns the request it stored', () => {
    const cache: DriveListingRequests = new Map()
    const pending = request('a')

    expect(rememberDriveListing(cache, 'a', pending)).toBe(pending)
    expect(cache.get('a')).toBe(pending)
  })

  it('drops the oldest entry beyond the limit', () => {
    const cache: DriveListingRequests = new Map()

    rememberDriveListing(cache, 'a', request('a'), 2)
    rememberDriveListing(cache, 'b', request('b'), 2)
    rememberDriveListing(cache, 'c', request('c'), 2)

    expect(keys(cache)).toEqual(['b', 'c'])
  })

  it('moves a re-remembered key to the newest end', () => {
    const cache: DriveListingRequests = new Map()

    rememberDriveListing(cache, 'a', request('a'), 2)
    rememberDriveListing(cache, 'b', request('b'), 2)
    rememberDriveListing(cache, 'a', request('a2'), 2)
    rememberDriveListing(cache, 'c', request('c'), 2)

    expect(keys(cache)).toEqual(['a', 'c'])
  })
})
