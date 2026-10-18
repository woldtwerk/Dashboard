import { describe, expect, it } from 'vitest'
import type { DashboardMetric } from '../shared/types/dashboard'
import {
  formatBytes,
  formatCount,
  formatMetric,
  serviceHealthMeta,
  serviceStatusLabel
} from '../app/utils/dashboard'

const metric = (patch: Partial<DashboardMetric> = {}): DashboardMetric => ({
  id: 'm',
  domain: 'mail',
  label: 'Label',
  value: 1,
  ...patch
})

describe('formatCount', () => {
  it('groups digits', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1234)).toBe('1,234')
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})

describe('formatBytes', () => {
  it('keeps small values in bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('uses binary units without a trailing zero', () => {
    expect(formatBytes(1024)).toBe('1 KiB')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(1048576)).toBe('1 MiB')
    expect(formatBytes(1073741824)).toBe('1 GiB')
  })
})

describe('formatMetric', () => {
  it('formats counts and bytes', () => {
    expect(formatMetric(metric({ value: 4200 }))).toBe('4,200')
    expect(formatMetric(metric({ value: 1536, unit: 'bytes' }))).toBe('1.5 KiB')
  })

  it('renders a missing value as an em dash', () => {
    expect(formatMetric(metric({ value: null }))).toBe('—')
  })
})

describe('serviceHealthMeta', () => {
  it('maps each health to an icon, label and status color', () => {
    expect(serviceHealthMeta('ok')).toMatchObject({ label: 'Synced', icon: 'i-lucide-circle-check', color: 'var(--status-good)' })
    expect(serviceHealthMeta('error')).toMatchObject({ label: 'Error', color: 'var(--status-critical)' })
    expect(serviceHealthMeta('unknown')).toMatchObject({ label: 'Unknown' })
  })

  it('marks syncing as spinning', () => {
    expect(serviceHealthMeta('syncing').spinning).toBe(true)
    expect(serviceHealthMeta('ok').spinning).toBe(false)
  })
})

describe('serviceStatusLabel', () => {
  const now = new Date('2024-01-01T12:00:00Z')

  it('appends the relative sync time to a healthy service', () => {
    expect(serviceStatusLabel('ok', '2024-01-01T11:58:00Z', now)).toBe('Synced 2 min ago')
  })

  it('keeps the plain label without a timestamp or for other states', () => {
    expect(serviceStatusLabel('ok', null, now)).toBe('Synced')
    expect(serviceStatusLabel('syncing', null, now)).toBe('Syncing')
    expect(serviceStatusLabel('error', null, now)).toBe('Error')
  })
})
