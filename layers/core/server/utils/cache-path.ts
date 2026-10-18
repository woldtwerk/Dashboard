import { join } from 'node:path'

/** SQLite file of a domain's cache; the domain names the file, so it must not escape it */
export function cacheDbPath(dir: string, domain: string): string {
  if (!/^[a-z0-9-]+$/.test(domain)) {
    throw new Error(`Invalid cache database domain "${domain}"`)
  }

  return join(dir, `${domain}.sqlite`)
}
