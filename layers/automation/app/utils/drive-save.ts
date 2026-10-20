/** The file type shortcuts the inspector offers for a save-to-drive action */
export type MimePresetValue = 'all' | 'videos' | 'images' | 'pdf' | 'custom'

export interface MimePreset {
  value: Exclude<MimePresetValue, 'custom'>
  label: string
  accept: string[]
}

export const MIME_PRESETS: MimePreset[] = [
  { value: 'all', label: 'All files', accept: [] },
  { value: 'videos', label: 'Videos', accept: ['video/*'] },
  { value: 'images', label: 'Images', accept: ['image/*'] },
  { value: 'pdf', label: 'PDF', accept: ['application/pdf'] }
]

/** Which preset an accept list matches; anything else is a custom list */
export function mimePresetFor(accept?: readonly string[]): MimePresetValue {
  const normalized = [...new Set(accept ?? [])].sort()
  return MIME_PRESETS.find(preset => preset.accept.slice().sort().join(',') === normalized.join(','))?.value ?? 'custom'
}

/** The accept list a preset stands for; `custom` keeps the current list */
export function acceptForPreset(value: MimePresetValue, current: readonly string[] = []): string[] {
  if (value === 'custom') {
    return [...current]
  }
  return [...(MIME_PRESETS.find(preset => preset.value === value)?.accept ?? [])]
}

/** The free-text field's value, e.g. `video/*, application/pdf` */
export function formatAccept(accept?: readonly string[]): string {
  return (accept ?? []).join(', ')
}
