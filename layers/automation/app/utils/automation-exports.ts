/**
 * Downloads the activity page offers next to its built-in corrections export.
 * The automation layer knows nothing about the layers that add one; each registers
 * its entry from a client plugin and the page renders whatever is registered.
 */

export interface AutomationExport {
  id: string
  label: string
  icon: string
  /** The download URL; the server names the file, so the browser can save it directly */
  to: string
  /** Optional URL returning an {@link AutomationExportSummary}, fetched when the menu opens */
  summary?: string
}

/** The fields of a `format=summary` response the page shows */
export interface AutomationExportSummary {
  rows: number
  labels?: Record<string, number>
  skipped?: Record<string, number>
}

const entries = new Map<string, AutomationExport>()

/** Called by a layer's plugin; a re-registration replaces the earlier entry */
export function registerAutomationExport(entry: AutomationExport) {
  entries.set(entry.id, entry)
}

/** Test hook; a client render registers its exports once at startup */
export function resetAutomationExports() {
  entries.clear()
}

/** The registered exports, in registration order */
export function automationExports(): AutomationExport[] {
  return [...entries.values()]
}

export function automationExport(id: string): AutomationExport | undefined {
  return entries.get(id)
}

/** A short menu line: the row count and the labels it contains */
export function formatAutomationExportSummary(summary: AutomationExportSummary): string {
  const labels = Object.entries(summary.labels ?? {})
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`)

  const rows = summary.rows === 1 ? '1 row' : `${summary.rows} rows`
  return labels.length ? `${rows} · ${labels.join(', ')}` : rows
}
