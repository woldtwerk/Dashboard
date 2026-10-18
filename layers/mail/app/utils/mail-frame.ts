/** The iframe never gets smaller than this, so an empty mail still shows a body */
export const MIN_FRAME_HEIGHT = 32

/**
 * The height a mail's iframe needs to show all of its content: the larger of the
 * document's and the body's scroll height, so a mail styled on `html` is measured too.
 */
export function contentHeight(doc: Document | null | undefined): number {
  if (!doc) {
    return MIN_FRAME_HEIGHT
  }

  const measured = Math.max(
    doc.documentElement?.scrollHeight ?? 0,
    doc.body?.scrollHeight ?? 0
  )

  return Math.max(measured, MIN_FRAME_HEIGHT)
}
