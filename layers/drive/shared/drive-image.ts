/**
 * The image source id of a drive entry: the service that holds it and the
 * entry's path. The image layer treats it as opaque; only this layer reads it
 * back apart. The path already begins with `/`, so the first slash separates
 * the two halves without an empty segment:
 *
 *   driveImageId('work', '/my-files/a.png') // 'work/my-files/a.png'
 */
export function driveImageId(service: string, path: string): string {
  return `${service}${path.startsWith('/') ? path : `/${path}`}`
}

/** Splits a drive source id back into its service and its path. */
export function parseDriveImageId(id: string): { service: string, path: string } | undefined {
  const slash = id.indexOf('/')
  if (slash <= 0 || slash === id.length - 1) {
    return undefined
  }

  return { service: id.slice(0, slash), path: id.slice(slash) }
}
