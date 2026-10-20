import { describe, expect, it } from 'vitest'
import {
  contextTargets,
  conversationSelectionFromQuery,
  conversationSelectionToQuery,
  isMailSelected,
  mailSelectionKey,
  MAIL_SELECTION_MAX,
  rangeSelection,
  selectionFromQuery,
  selectionToQuery,
  toggleSelection
} from '../app/utils/mail-selection'

const key = (mailbox: string, uid: number) => `${mailbox}:${uid}`

describe('toggleSelection', () => {
  it('adds a mail in click order', () => {
    expect(toggleSelection([], 'INBOX:2')).toEqual(['INBOX:2'])
    expect(toggleSelection(['INBOX:2'], 'INBOX:5')).toEqual(['INBOX:2', 'INBOX:5'])
  })

  it('removes a mail that is already selected', () => {
    expect(toggleSelection(['INBOX:2', 'INBOX:5'], 'INBOX:2')).toEqual(['INBOX:5'])
  })
})

describe('rangeSelection', () => {
  const keys = ['INBOX:1', 'INBOX:2', 'INBOX:3', 'INBOX:4']

  it('selects forward from the anchor to the target', () => {
    expect(rangeSelection(keys, 'INBOX:2', 'INBOX:4')).toEqual(['INBOX:2', 'INBOX:3', 'INBOX:4'])
  })

  it('selects backward as well', () => {
    expect(rangeSelection(keys, 'INBOX:4', 'INBOX:2')).toEqual(['INBOX:2', 'INBOX:3', 'INBOX:4'])
  })

  it('falls back to the target without a usable anchor', () => {
    expect(rangeSelection(keys, undefined, 'INBOX:3')).toEqual(['INBOX:3'])
    expect(rangeSelection(keys, 'GONE:1', 'INBOX:3')).toEqual(['INBOX:3'])
    expect(rangeSelection(keys, 'INBOX:1', 'GONE:3')).toEqual(['GONE:3'])
  })
})

describe('selectionToQuery', () => {
  it('groups the uids per mailbox in selection order', () => {
    expect(selectionToQuery(['INBOX:2', 'Archive:9', 'INBOX:5'])).toBe('INBOX:2,5;Archive:9')
  })

  it('is null for an empty selection', () => {
    expect(selectionToQuery([])).toBeNull()
  })

  it('encodes a mailbox so its separators survive', () => {
    const value = selectionToQuery([key('Archive/2024, Q1; x:y', 7)])
    expect(value).toBe(`${encodeURIComponent('Archive/2024, Q1; x:y')}:7`)
    expect(selectionFromQuery({ sel: value })).toEqual([key('Archive/2024, Q1; x:y', 7)])
  })

  it('caps the selection', () => {
    const selection = Array.from({ length: MAIL_SELECTION_MAX + 20 }, (_, index) => key('INBOX', index + 1))
    const value = selectionToQuery(selection)!

    expect(selectionFromQuery({ sel: value })).toHaveLength(MAIL_SELECTION_MAX)
  })
})

describe('selectionFromQuery', () => {
  it('reads grouped mailboxes from the URL', () => {
    expect(selectionFromQuery({ sel: 'INBOX:2,5;Archive:9' })).toEqual(['INBOX:2', 'INBOX:5', 'Archive:9'])
  })

  it('drops malformed groups and duplicates', () => {
    expect(selectionFromQuery({ sel: 'INBOX:2,nope,2;:4;Bad;Archive:x' })).toEqual(['INBOX:2'])
  })

  it('reads several sel parameters and is empty without one', () => {
    expect(selectionFromQuery({ sel: ['INBOX:1', 'Archive:2'] })).toEqual(['INBOX:1', 'Archive:2'])
    expect(selectionFromQuery({})).toEqual([])
  })
})

describe('contextTargets', () => {
  const selection = ['INBOX:1', 'INBOX:2']

  it('acts on the whole selection when the clicked mail is in it', () => {
    expect(contextTargets(selection, 'INBOX:2')).toEqual(selection)
  })

  it('acts on the clicked mail alone when it is not selected', () => {
    expect(contextTargets(selection, 'INBOX:3')).toEqual(['INBOX:3'])
  })
})

describe('mailSelectionKey', () => {
  it('uses the mailbox and uid, and matches the row', () => {
    const mail = { mailbox: 'Archive/2024', uid: 12 }
    expect(mailSelectionKey(mail)).toBe('Archive/2024:12')
    expect(isMailSelected(['Archive/2024:12'], mail)).toBe(true)
    expect(isMailSelected(['INBOX:12'], mail)).toBe(false)
  })
})

describe('conversationSelectionToQuery', () => {
  it('encodes every key so its own separators survive', () => {
    const keys = ['subj:alice@example.com:hello, world', 'list:news.example']
    const value = conversationSelectionToQuery(keys)!

    expect(conversationSelectionFromQuery({ sel: value })).toEqual(keys)
  })

  it('is null for an empty selection and caps the rest', () => {
    expect(conversationSelectionToQuery([])).toBeNull()

    const keys = Array.from({ length: MAIL_SELECTION_MAX + 10 }, (_, index) => `id:${index + 1}`)
    expect(conversationSelectionFromQuery({ sel: conversationSelectionToQuery(keys) })).toHaveLength(MAIL_SELECTION_MAX)
  })
})

describe('conversationSelectionFromQuery', () => {
  it('drops malformed parts and duplicates', () => {
    expect(conversationSelectionFromQuery({ sel: 'id:a,%2C,%E0%A4%A,id:a,id:b' })).toEqual(['id:a', ',', 'id:b'])
  })

  it('reads several sel parameters and is empty without one', () => {
    expect(conversationSelectionFromQuery({ sel: ['id:a', 'id:b'] })).toEqual(['id:a', 'id:b'])
    expect(conversationSelectionFromQuery({})).toEqual([])
  })
})
