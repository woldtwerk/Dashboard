import { describe, expect, it } from 'vitest'
import { extractValue, runActions } from '../server/utils/action-runner'
import type { ActionRunContext, PaymentActionPort } from '../server/utils/action-runner'
import type { DriveFileHistory, DriveSavePort } from '../../drive/server/utils/drive-save'
import { sha256Hex } from '../../drive/shared/drive-upload'
import type { AutomationApplier } from '../server/utils/engine'
import type { MailAttachment } from '../../mail/shared/types/mail'
import type { AppliedAction, AutomationItem, PlannedAction, UndoOperation } from '../shared/types/automation'
import { formatMoney } from '../../payments/shared/money'

function mailItem(overrides: Partial<AutomationItem> = {}): AutomationItem {
  return {
    domain: 'mail',
    service: 'mail-1',
    key: 'INBOX|1|m1',
    mailbox: 'INBOX',
    uid: 1,
    unread: true,
    flagged: false,
    fields: { from: 'GitHub <noreply@github.com>', subject: 'Your login code', text: 'Your verification code is 482913' },
    state: 'state',
    title: 'Your login code',
    ...overrides
  }
}

function planned(actions: Array<PlannedAction['action']>, ids?: string[]): PlannedAction[] {
  return actions.map((action, index) => ({ nodeId: ids?.[index] ?? `node-${index}`, action }))
}

/** An applier that records each call and moves the uid on, like a real mail move */
function fakeApplier(): AutomationApplier & { calls: Array<{ actions: string[], item: AutomationItem }> } {
  const calls: Array<{ actions: string[], item: AutomationItem }> = []
  return {
    calls,
    async apply(actions, item) {
      calls.push({ actions: actions.map(action => action.type), item })
      const applied: AppliedAction[] = actions.map(action => action.type === 'move-to'
        ? { type: 'move-to', folder: action.folder, from: item.mailbox!, uid: (item.uid ?? 0) + 100 }
        : { type: 'star', mailbox: item.mailbox!, uid: item.uid ?? 0, wasFlagged: false })
      return { applied, item: { ...item, uid: (item.uid ?? 0) + 100 } }
    },
    async undo(_operations: UndoOperation[]) {}
  }
}

describe('extractValue', () => {
  it('reads a login code from the body by default', () => {
    expect(extractValue({ type: 'extract', variable: 'code', extractor: 'login-code' }, mailItem())).toBe('482913')
  })

  it('can read from the subject', () => {
    const item = mailItem({ fields: { subject: 'Your code is ABC-123', text: '' } })
    expect(extractValue({ type: 'extract', variable: 'code', extractor: 'login-code', source: 'subject' }, item)).toBe('ABC123')
  })

  it('uses a regex pattern', () => {
    expect(extractValue({ type: 'extract', variable: 'order', extractor: 'regex', pattern: 'order (\\d+)' }, mailItem({ fields: { text: 'Your ORDER 4711 shipped' } }))).toBe('4711')
  })
})

describe('runActions', () => {
  it('extracts a variable and renders it into a notification and its modal', async () => {
    const now = new Date('2026-10-19T12:00:00.000Z')
    const { applied, variables } = await runActions(planned([
      { type: 'extract', variable: 'code', extractor: 'login-code' },
      {
        type: 'notify',
        title: 'Login code from {{from}}',
        body: '{{subject}} — {{code}}',
        modal: { title: 'Login code', text: '{{code}}', copy: true, expiresInMinutes: 15 }
      }
    ]), mailItem(), fakeApplier(), { workflow: 'Login codes', now: () => now })

    expect(variables).toEqual({ code: '482913' })
    expect(applied).toEqual([
      { type: 'extract', variable: 'code', value: '482913' },
      {
        type: 'notify',
        nodeId: 'node-1',
        title: 'Login code from GitHub <noreply@github.com>',
        body: 'Your login code — 482913',
        modal: {
          title: 'Login code',
          text: '482913',
          copy: true,
          expiresAt: '2026-10-19T12:15:00.000Z'
        }
      }
    ])
  })

  it('renders built-in variables and turns unknown ones into an empty string', async () => {
    const { applied } = await runActions(planned([
      { type: 'notify', title: '{{workflow}}: {{title}}', body: '{{nope}}' }
    ]), mailItem(), fakeApplier(), { workflow: 'Invoices' })

    expect(applied[0]).toMatchObject({ title: 'Invoices: Your login code', body: '' })
  })

  it('hands each domain action to the applier one at a time and carries the item forward', async () => {
    const applier = fakeApplier()
    const { applied, item } = await runActions(planned([
      { type: 'move-to', folder: 'Archive' },
      { type: 'star' }
    ]), mailItem(), applier)

    expect(applier.calls.map(call => call.actions)).toEqual([['move-to'], ['star']])
    expect(applier.calls[1]!.item.uid).toBe(101)
    expect(item.uid).toBe(201)
    expect(applied.map(action => action.type)).toEqual(['move-to', 'star'])
  })

  it('stops at a failed extract, so a following trash never runs', async () => {
    const applier = fakeApplier()

    await expect(runActions(planned([
      { type: 'extract', variable: 'code', extractor: 'login-code' },
      { type: 'trash' }
    ]), mailItem({ fields: { text: 'Your invoice 123456789012 is attached.' } }), applier))
      .rejects.toThrow('No code found')

    expect(applier.calls).toEqual([])
  })
})

// --- Save to drive --------------------------------------------------------

const encoder = new TextEncoder()

function attachment(filename: string, contentType: string, body: string): MailAttachment & { content: Uint8Array } {
  return { filename, contentType, size: encoder.encode(body).byteLength, content: encoder.encode(body) }
}

function fakeDrive(initial: Array<{ name: string, size: number }> = []) {
  const entries: Array<{ name: string, type: 'file' | 'folder', size?: number }> = initial.map(entry => ({ ...entry, type: 'file' }))
  const ensured: string[] = []
  const listed: string[] = []
  const uploaded: Array<{ folder: string, name: string, contentType: string }> = []

  const drive: DriveSavePort = {
    async ensureFolder(_service, path) {
      ensured.push(path)
    },
    async list(_service, path) {
      listed.push(path)
      return entries.map(entry => ({ ...entry }))
    },
    async upload(_service, folder, file) {
      uploaded.push({ folder, name: file.name, contentType: file.contentType })
      entries.push({ name: file.name, type: 'file', size: file.content.byteLength })
    }
  }

  return { drive, ensured, listed, uploaded }
}

/** The content records, keyed like the database's unique index */
function fakeHistory(preloaded: Array<{ service: string, folder: string, sha256: string, path: string, size: number }> = []) {
  const rows = new Map(preloaded.map(row => [`${row.service}:${row.folder}:${row.sha256}`, row]))
  const recorded: Array<{ service: string, folder: string, sha256: string, path: string, size: number }> = []

  const history: DriveFileHistory = {
    async has(service, folder, sha256) {
      return rows.has(`${service}:${folder}:${sha256}`)
    },
    async record(file) {
      const key = `${file.service}:${file.folder}:${file.sha256}`
      const exists = rows.has(key)
      if (!exists) {
        rows.set(key, file)
        recorded.push(file)
      }
      return !exists
    }
  }

  return { history, rows, recorded }
}

function saveContext(
  files: Array<MailAttachment & { content: Uint8Array }>,
  drive: DriveSavePort,
  history: DriveFileHistory = fakeHistory().history
): ActionRunContext {
  return { itemFiles: async () => files, drive, driveHistory: history }
}

describe('runActions: save-to-drive', () => {
  it.each([
    {
      branch: 'no matching attachment, without touching the drive',
      files: [attachment('invoice.pdf', 'application/pdf', 'pdf')],
      preloaded: false,
      ensured: [],
      listed: [],
      uploaded: [],
      applied: { paths: [], skipped: [], matched: 0 }
    },
    {
      branch: 'a file whose bytes were already saved',
      files: [attachment('clip.mp4', 'video/mp4', 'video')],
      preloaded: true,
      ensured: ['/my-files/Public'],
      listed: ['/my-files/Public'],
      uploaded: [],
      applied: { paths: [], skipped: [{ name: 'clip.mp4', reason: 'duplicate' }], matched: 1 }
    },
    {
      branch: 'the matching attachment among others',
      files: [
        attachment('clip.mp4', 'video/mp4', 'video'),
        attachment('invoice.pdf', 'application/pdf', 'pdf')
      ],
      preloaded: false,
      ensured: ['/my-files/Public'],
      listed: ['/my-files/Public'],
      uploaded: ['clip.mp4'],
      applied: { paths: ['/my-files/Public/clip.mp4'], skipped: [], matched: 1 }
    }
  ])('records $branch', async ({ files, preloaded, ensured, listed, uploaded: uploadedNames, applied: expected }) => {
    const fake = fakeDrive()
    const content = files[0]!.content
    const history = preloaded
      ? fakeHistory([{
        service: 'drive-1',
        folder: '/my-files/Public',
        sha256: await sha256Hex(content),
        path: '/my-files/Public/old.mp4',
        size: content.byteLength
      }]).history
      : fakeHistory().history

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext(files, fake.drive, history))

    expect(applied).toEqual([{ type: 'save-to-drive', service: 'drive-1', ...expected }])
    expect(fake.ensured).toEqual(ensured)
    expect(fake.listed).toEqual(listed)
    expect(fake.uploaded.map(entry => entry.name)).toEqual(uploadedNames)
  })

  it('saves into the normalised path of a hand-written folder', async () => {
    const { drive, ensured, uploaded } = fakeDrive()

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: 'Public/salsa/', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext([attachment('clip.mp4', 'video/mp4', 'video')], drive))

    expect(ensured).toEqual(['/my-files/Public/salsa'])
    expect(uploaded).toEqual([{ folder: '/my-files/Public/salsa', name: 'clip.mp4', contentType: 'video/mp4' }])
    expect(applied).toEqual([{
      type: 'save-to-drive',
      service: 'drive-1',
      paths: ['/my-files/Public/salsa/clip.mp4'],
      skipped: [],
      matched: 1
    }])
  })

  it('stops before a following trash when an upload fails', async () => {
    const applier = fakeApplier()
    const drive: DriveSavePort = {
      async ensureFolder() {},
      async list() { return [] },
      async upload() { throw new Error('Drive is full') }
    }

    await expect(runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] },
      { type: 'trash' }
    ]), mailItem(), applier, saveContext([attachment('clip.mp4', 'video/mp4', 'video')], drive)))
      .rejects.toThrow('Drive is full')

    expect(applier.calls).toEqual([])
  })
})

// --- Payments -------------------------------------------------------------

interface FakeRequest {
  id: string
  reference: string
  status: 'open' | 'paid' | 'cancelled'
  amountCents: number
  paidCents: number
  payerName: string
}

function fakePayments(initial: FakeRequest[] = []) {
  const requests = new Map(initial.map(request => [request.id, { ...request }]))
  const created: Array<{ title: string, amountCents: number, payerName: string, payerEmail?: string }> = []
  const sent: string[] = []
  const failedSends = new Set<string>()
  const paidSources = new Set<string>()
  let next = 1

  const port: PaymentActionPort = {
    async createRequests(_service, input) {
      created.push(...input)
      return input.map((entry) => {
        const id = `req-${next++}`
        requests.set(id, {
          id,
          reference: `AM-REF${next}`,
          status: 'open',
          amountCents: entry.amountCents,
          paidCents: 0,
          payerName: entry.payerName
        })
        return { id, reference: `AM-REF${next}`, amountCents: entry.amountCents }
      })
    },
    async sendRequest(id) {
      if (failedSends.has(id)) {
        throw new Error('Mail refused')
      }
      sent.push(id)
    },
    async openRequests() {
      return [...requests.values()]
        .filter(request => request.status === 'open')
        .map(request => ({
          id: request.id,
          reference: request.reference,
          amountCents: request.amountCents,
          payerName: request.payerName
        }))
    },
    async markPaid(id, input) {
      if (paidSources.has(input.source)) {
        return false
      }
      const request = requests.get(id)
      if (!request || request.status !== 'open') {
        return false
      }
      paidSources.add(input.source)
      request.paidCents += input.cents
      if (request.paidCents >= request.amountCents) {
        request.status = 'paid'
      }
      return true
    },
    async getRequest(id) {
      const request = requests.get(id)
      return request ? { status: request.status, paidCents: request.paidCents } : undefined
    },
    async paidRequestForSource(_service, source) {
      if (!paidSources.has(source)) {
        return undefined
      }
      const request = [...requests.values()].find(entry => entry.status === 'paid')
      return request ? { requestId: request.id, reference: request.reference } : undefined
    }
  }

  return { port, requests, created, sent, failedSends }
}

describe('runActions: request-payment', () => {
  it('creates one request per payer with its split amount and records the ids', async () => {
    const payments = fakePayments()
    const payers = [
      { name: 'Anna', email: 'anna@example.com' },
      { name: 'Ben', email: 'ben@example.com' },
      { name: 'Clara', email: 'clara@example.com' }
    ]

    const { applied, variables } = await runActions(planned([
      {
        type: 'request-payment',
        payee: 'payee-1',
        amount: '12,00 €',
        title: 'Spotify',
        shares: 4,
        payers,
        send: true
      }
    ]), mailItem(), fakeApplier(), { payments: payments.port, runId: 'run-1' })

    expect(payments.created).toEqual([
      { title: 'Spotify', amountCents: 300, payerName: 'Anna', payerEmail: 'anna@example.com', contactService: undefined, contactUid: undefined },
      { title: 'Spotify', amountCents: 300, payerName: 'Ben', payerEmail: 'ben@example.com', contactService: undefined, contactUid: undefined },
      { title: 'Spotify', amountCents: 300, payerName: 'Clara', payerEmail: 'clara@example.com', contactService: undefined, contactUid: undefined }
    ])
    expect(applied).toEqual([{ type: 'request-payment', requestIds: ['req-1', 'req-2', 'req-3'], sent: ['req-1', 'req-2', 'req-3'] }])
    expect(variables).toEqual({
      paymentTotal: formatMoney(1200),
      paymentShare: formatMoney(300),
      paymentReferences: 'AM-REF2, AM-REF3, AM-REF4'
    })
  })

  it('keeps the requests and records only the mails that went out', async () => {
    const payments = fakePayments()
    payments.failedSends.add('req-2')

    const { applied } = await runActions(planned([
      {
        type: 'request-payment',
        payee: 'payee-1',
        amount: '12,00 €',
        title: 'Spotify',
        shares: 4,
        payers: [
          { name: 'Anna', email: 'anna@example.com' },
          { name: 'Ben', email: 'ben@example.com' },
          { name: 'Clara', email: 'clara@example.com' }
        ],
        send: true
      }
    ]), mailItem(), fakeApplier(), { payments: payments.port, runId: 'run-1' })

    expect(applied).toEqual([{ type: 'request-payment', requestIds: ['req-1', 'req-2', 'req-3'], sent: ['req-1', 'req-3'] }])
  })

  it('stops the chain when the rendered amount is not a positive amount', async () => {
    const applier = fakeApplier()
    const payments = fakePayments()

    await expect(runActions(planned([
      {
        type: 'request-payment',
        payee: 'payee-1',
        amount: '{{amount}}',
        title: 'Spotify',
        shares: 2,
        payers: [{ name: 'Anna', email: 'anna@example.com' }],
        send: true
      },
      { type: 'trash' }
    ]), mailItem({ fields: { text: 'Gesamt: keine Angabe' } }), applier, { payments: payments.port }))
      .rejects.toThrow('is not a positive amount')

    expect(payments.created).toEqual([])
    expect(applier.calls).toEqual([])
  })
})

describe('runActions: confirm-paypal-payment', () => {
  const PAYPAL_HEADER = 'mx.protonmail.ch; dkim=pass (2048-bit key) header.d=paypal.de header.s=protonmail'

  function paypalItem(): AutomationItem {
    return mailItem({
      messageId: '<paypal-1@paypal.de>',
      fields: {
        from: 'service@paypal.de',
        subject: 'Sie haben Geld erhalten',
        text: 'Anna Müller hat Ihnen 2,83 € EUR gesendet.\n\nMitteilung\nAM-REF1'
      }
    })
  }

  function openRequest(): FakeRequest {
    return {
      id: 'req-1',
      reference: 'AM-REF1',
      status: 'open',
      amountCents: 283,
      paidCents: 0,
      payerName: 'Anna Müller'
    }
  }

  function context(payments: ReturnType<typeof fakePayments>, headers: string[]): ActionRunContext {
    return {
      payments: payments.port,
      trustedAuthservIds: ['mx.protonmail.ch'],
      mailAuthenticationResults: async () => headers
    }
  }

  it('marks the matching request paid when DKIM is aligned', async () => {
    const payments = fakePayments([openRequest()])

    const { applied, variables } = await runActions(planned([
      { type: 'confirm-paypal-payment', payee: 'payee-1' }
    ]), paypalItem(), fakeApplier(), context(payments, [PAYPAL_HEADER]))

    expect(applied).toEqual([{
      type: 'confirm-paypal-payment',
      outcome: 'paid',
      requestId: 'req-1',
      cents: 283,
      paidCents: 283
    }])
    expect(payments.requests.get('req-1')).toMatchObject({ status: 'paid', paidCents: 283 })
    expect(variables).toEqual({
      paymentReference: 'AM-REF1',
      paymentPayer: 'Anna Müller',
      paymentAmount: formatMoney(283)
    })
  })

  it('leaves every request untouched and asks the owner to look when DKIM is not aligned', async () => {
    const payments = fakePayments([openRequest()])
    const announced: string[] = []
    const item = paypalItem()

    const { applied } = await runActions(planned([
      { type: 'confirm-paypal-payment', payee: 'payee-1' }
    ]), item, fakeApplier(), {
      ...context(payments, ['attacker.example; dkim=pass header.d=paypal.de']),
      announcePaymentReview: (review) => { announced.push(review.title) }
    })

    expect(applied).toEqual([{ type: 'confirm-paypal-payment', outcome: 'unverified' }])
    expect(payments.requests.get('req-1')).toMatchObject({ status: 'open', paidCents: 0 })
    expect(announced).toHaveLength(1)
  })

  it('does not pay twice when the same mail runs again', async () => {
    const payments = fakePayments([openRequest()])
    const actions = planned([{ type: 'confirm-paypal-payment', payee: 'payee-1' }])

    const first = await runActions(actions, paypalItem(), fakeApplier(), context(payments, [PAYPAL_HEADER]))
    const second = await runActions(actions, paypalItem(), fakeApplier(), context(payments, [PAYPAL_HEADER]))

    expect(first.applied[0]).toMatchObject({ outcome: 'paid' })
    expect(second.applied[0]).toMatchObject({ outcome: 'already-paid' })
    expect(payments.requests.get('req-1')).toMatchObject({ status: 'paid', paidCents: 283 })
  })
})
