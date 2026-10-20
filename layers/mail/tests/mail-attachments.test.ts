import { describe, expect, it } from 'vitest'
import {
  adjacentAttachmentPart,
  attachmentPreviewIndex,
  attachmentsFromStructure,
  contentIdsFromHtml,
  decodedPartSize,
  mailAttachmentByPart,
  mailEntityRef,
  mailRefTarget,
  visibleMailAttachments,
  type MailPartStructure
} from '../shared/mail-attachments'

const referenced = new Set(['logo@example.com'])

const nested: MailPartStructure = {
  type: 'multipart/mixed',
  childNodes: [
    {
      part: '1',
      type: 'multipart/related',
      childNodes: [
        { part: '1.1', type: 'text/plain' },
        { part: '1.2', type: 'text/html' },
        {
          part: '1.3',
          type: 'image/png',
          id: '<logo@example.com>',
          disposition: 'inline',
          dispositionParameters: { filename: 'signature.png' },
          encoding: 'base64',
          size: 8
        }
      ]
    },
    {
      part: '2',
      type: 'application/pdf',
      disposition: 'attachment',
      dispositionParameters: { filename: '../report.pdf' },
      encoding: 'base64',
      size: 8
    },
    { part: '3', type: 'image/jpeg', disposition: 'attachment', size: 5 }
  ]
}

describe('attachmentsFromStructure', () => {
  it('walks nested multipart parts and drops body text', () => {
    const attachments = attachmentsFromStructure(nested, referenced)

    expect(attachments).toEqual([
      {
        filename: 'signature.png',
        contentType: 'image/png',
        size: 6,
        part: '1.3',
        inline: true,
        contentId: '<logo@example.com>'
      },
      {
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 6,
        part: '2',
        inline: false,
        contentId: undefined
      },
      {
        filename: 'attachment-3.jpg',
        contentType: 'image/jpeg',
        size: 5,
        part: '3',
        inline: false,
        contentId: undefined
      }
    ])
  })

  it('marks a content-id the html references as inline even without an inline disposition', () => {
    const attachments = attachmentsFromStructure({
      type: 'multipart/related',
      childNodes: [
        { part: '1', type: 'text/html' },
        { part: '2', type: 'image/gif', parameters: { name: 'pixel.gif' }, id: 'pixel@example.com', size: 10 }
      ]
    }, contentIdsFromHtml('<img src="cid:<pixel@example.com>">'))

    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({ part: '2', inline: true, filename: 'pixel.gif' })
  })

  it('keeps an embedded message as an attachment', () => {
    const attachments = attachmentsFromStructure({
      type: 'multipart/mixed',
      childNodes: [
        { part: '1', type: 'text/plain' },
        { part: '2', type: 'message/rfc822', disposition: 'attachment', dispositionParameters: { filename: 'forwarded.eml' }, size: 120 }
      ]
    })

    expect(attachments).toEqual([{
      filename: 'forwarded.eml',
      contentType: 'message/rfc822',
      size: 120,
      part: '2',
      inline: false,
      contentId: undefined
    }])
  })

  it('names a part that has no name at all', () => {
    const attachments = attachmentsFromStructure({ part: '2', type: 'application/pdf', disposition: 'attachment' })

    expect(attachments[0]).toMatchObject({ filename: 'attachment-1.pdf', part: '2' })
  })

  it('keeps a named inline attachment the body does not reference', () => {
    const attachments = attachmentsFromStructure({
      part: '2',
      type: 'application/pdf',
      disposition: 'inline',
      dispositionParameters: { filename: 'scan.pdf' }
    }, new Set())

    expect(attachments[0]).toMatchObject({ filename: 'scan.pdf', inline: false })
    expect(visibleMailAttachments(attachments).map(attachment => attachment.part)).toEqual(['2'])
  })
})

describe('decodedPartSize', () => {
  it('estimates a base64 part at three quarters of its wire size', () => {
    expect(decodedPartSize(8, 'base64')).toBe(6)
    expect(decodedPartSize(8, 'BASE64')).toBe(6)
    expect(decodedPartSize(8, '7bit')).toBe(8)
    expect(decodedPartSize(undefined, 'base64')).toBe(0)
  })
})

describe('visible attachments', () => {
  const attachments = attachmentsFromStructure(nested, referenced)

  it('hides inline parts and parts without a part number', () => {
    expect(visibleMailAttachments(attachments).map(attachment => attachment.part)).toEqual(['2', '3'])
    expect(visibleMailAttachments([{ filename: 'x', contentType: 'text/plain', size: 1 }])).toEqual([])
  })

  it('finds a part and its neighbours without wrapping', () => {
    const visible = visibleMailAttachments(attachments)

    expect(mailAttachmentByPart(attachments, '2')?.filename).toBe('report.pdf')
    expect(attachmentPreviewIndex(visible, '3')).toBe(1)
    expect(adjacentAttachmentPart(visible, '2', 1)).toBe('3')
    expect(adjacentAttachmentPart(visible, '2', -1)).toBeUndefined()
    expect(adjacentAttachmentPart(visible, '3', 1)).toBeUndefined()
    expect(adjacentAttachmentPart(visible, undefined, 1)).toBe('2')
    expect(adjacentAttachmentPart(visible, undefined, -1)).toBe('3')
  })
})

describe('mail refs', () => {
  it('round-trips a mailbox and uid', () => {
    const ref = mailEntityRef('mail-1', 'Folders/Work', 42)

    expect(mailRefTarget(ref)).toEqual({ service: 'mail-1', mailbox: 'Folders/Work', uid: 42 })
  })

  it('rejects other entities and malformed refs', () => {
    expect(mailRefTarget('file:drive-1:%2Fmy-files%2Fx')).toBeUndefined()
    expect(mailRefTarget('mail:mail-1:INBOX%2Fnot-a-uid')).toBeUndefined()
    expect(mailRefTarget('nonsense')).toBeUndefined()
  })
})
