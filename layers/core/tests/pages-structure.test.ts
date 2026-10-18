import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Nuxt treats `pages/foo.vue` as the parent route of every page inside
// `pages/foo/`, so the child changes the URL while the parent's template keeps
// rendering. Without a `<NuxtPage />` the child is unreachable — the bug that
// made opening a document leave the list on screen. This guard checks every
// layer so the nesting cannot come back.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const layersDir = join(repoRoot, 'layers')

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return pageFiles(path)
    }
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

/** Pages roots (`<layer>/app/pages`) that exist across all layers. */
function pagesRoots(): string[] {
  return readdirSync(layersDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(layersDir, entry.name, 'app', 'pages'))
    .filter(root => existsSync(root))
}

interface Violation {
  page: string
  childDir: string
}

function findMissingNuxtPage(): Violation[] {
  const violations: Violation[] = []

  for (const root of pagesRoots()) {
    for (const page of pageFiles(root)) {
      const name = basename(page, '.vue')
      // `index.vue` is the leaf route of its folder, never a parent wrapper.
      if (name === 'index') {
        continue
      }
      const childDir = join(dirname(page), name)
      if (existsSync(childDir) && !readFileSync(page, 'utf8').includes('<NuxtPage')) {
        violations.push({
          page: relative(repoRoot, page),
          childDir: relative(repoRoot, childDir)
        })
      }
    }
  }

  return violations
}

describe('page structure', () => {
  it('renders a <NuxtPage /> wherever a page wraps a same-named folder', () => {
    expect(findMissingNuxtPage()).toEqual([])
  })
})
