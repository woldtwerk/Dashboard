import { describe, expect, it } from 'vitest'
import type { DomainTool } from '../shared/types/tools'
import { calendarTools } from '../../calendar/server/tools'
import { contactsTools } from '../../contacts/server/tools'
import { documentsTools } from '../../documents/server/tools'
import { driveTools } from '../../drive/server/tools'
import { mailTools } from '../../mail/server/tools'

/** Every tool the domain layers register in their Nitro plugin. */
const domainTools: DomainTool[] = [
  ...mailTools,
  ...calendarTools,
  ...contactsTools,
  ...driveTools,
  ...documentsTools
]

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
const MUTATING = /_(?:create|update|delete|set|move|trash|rename|add)/
/** Tools whose name says "read" must not be flagged as writes */
const READING = /_(?:search|read|list|get|info)/

describe('domain tools', () => {
  it('registers at least one tool per domain', () => {
    const domains = new Set(domainTools.map(tool => tool.domain))

    expect(domains).toEqual(new Set(['mail', 'calendar', 'contacts', 'drive', 'documents']))
  })

  it('uses unique snake_case names', () => {
    const names = domainTools.map(tool => tool.name)

    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name).toMatch(SNAKE_CASE)
    }
  })

  it('describes every tool for the client', () => {
    for (const tool of domainTools) {
      expect(tool.description.trim().length).toBeGreaterThan(20)
    }
  })

  it('marks mutating tools as writes and read tools as read-only', () => {
    for (const tool of domainTools) {
      if (MUTATING.test(tool.name)) {
        expect(tool.writes, `${tool.name} should write`).toBe(true)
      }
      if (READING.test(tool.name)) {
        expect(tool.writes, `${tool.name} should be read-only`).toBe(false)
      }
    }
  })
})
