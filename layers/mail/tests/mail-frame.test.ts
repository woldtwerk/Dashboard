import { describe, expect, it } from 'vitest'
import { contentHeight, MIN_FRAME_HEIGHT } from '../app/utils/mail-frame'

/** Only the two scroll heights a measurement reads */
function frameDocument(html: number, body?: number): Document {
  return {
    documentElement: { scrollHeight: html },
    body: body === undefined ? null : { scrollHeight: body }
  } as unknown as Document
}

describe('contentHeight', () => {
  it('takes the larger of the document and body scroll heights', () => {
    expect(contentHeight(frameDocument(120, 480))).toBe(480)
    expect(contentHeight(frameDocument(640, 320))).toBe(640)
  })

  it('falls back to the document when the body is missing', () => {
    expect(contentHeight(frameDocument(210))).toBe(210)
  })

  it('never reports less than the minimum height', () => {
    expect(contentHeight(frameDocument(0, 0))).toBe(MIN_FRAME_HEIGHT)
    expect(contentHeight(frameDocument(12, 4))).toBe(MIN_FRAME_HEIGHT)
  })

  it('has a minimum height without a document', () => {
    expect(contentHeight(null)).toBe(MIN_FRAME_HEIGHT)
    expect(contentHeight(undefined)).toBe(MIN_FRAME_HEIGHT)
  })
})
