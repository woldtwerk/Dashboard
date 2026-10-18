/** One object as the server lists it: the href and its current etag. */
export interface ObjectRef {
  url: string
  etag?: string
}

export interface ObjectDiff {
  /** New objects and objects whose etag changed */
  changed: string[]
  /** Objects the server no longer lists */
  removed: string[]
}

/** Compares the cached objects of a calendar with the remote listing. */
export function diffObjects(cached: ObjectRef[], remote: ObjectRef[]): ObjectDiff {
  const cachedEtags = new Map(cached.map(object => [object.url, object.etag]))
  const remoteUrls = new Set(remote.map(object => object.url))

  return {
    changed: remote.filter(object => !cachedEtags.has(object.url) || cachedEtags.get(object.url) !== object.etag).map(object => object.url),
    removed: cached.filter(object => !remoteUrls.has(object.url)).map(object => object.url)
  }
}
