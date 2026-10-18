import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// `$fetch` is anonymous on the server: it carries no browser cookie, so an
// `useAsyncData` handler that calls it during SSR gets a 401 from the session
// guard. `useRequestFetch` forwards the incoming request's headers instead.
// This guard keeps the two from drifting apart across every layer.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const layersDir = join(repoRoot, 'layers')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(path)
    }
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

/** Every `.vue`/`.ts` file under a layer's `app/` directory. */
function appFiles(): string[] {
  return readdirSync(layersDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(layersDir, entry.name, 'app'))
    .filter(root => existsSync(root))
    .flatMap(root => sourceFiles(root))
}

/**
 * The text of the call whose opening parenthesis is at `openIndex`, up to its
 * matching close. Quotes are skipped so a parenthesis inside a string does not
 * throw the depth off.
 */
function callText(source: string, openIndex: number): string {
  let depth = 0
  let quote: string | undefined

  for (let index = openIndex; index < source.length; index++) {
    const char = source[index]

    if (quote) {
      if (char === '\\') {
        index++
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char
    } else if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
      if (depth === 0) {
        return source.slice(openIndex, index + 1)
      }
    }
  }

  return source.slice(openIndex)
}

function asyncDataCallsWithPlainFetch(): string[] {
  const violations: string[] = []

  for (const file of appFiles()) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/use(?:Lazy)?AsyncData\(/g)) {
      const openIndex = match.index! + match[0].length - 1
      const block = callText(source, openIndex)
      if (block.includes('$fetch(') && !block.includes('requestFetch')) {
        violations.push(`${relative(repoRoot, file)}: ${match[0]} handler calls $fetch without useRequestFetch`)
      }
    }
  }

  return violations
}

describe('SSR fetch', () => {
  it('forwards the request headers in every useAsyncData handler', () => {
    expect(asyncDataCallsWithPlainFetch()).toEqual([])
  })
})
