import { randomUUID } from 'node:crypto'
import type {
  AppliedAction,
  AutomationItem,
  ConfirmPaypalPaymentAction,
  ExtractAction,
  NotifyAction,
  PaymentPayer,
  PlannedAction,
  RequestPaymentAction,
  SaveToDriveAction
} from '../../shared/types/automation'
import type { FileSourceMeta } from '../../../core/shared/types/file-sources'
import { normalizeDriveFolderInput } from '../../../drive/shared/drive-path'
import { saveFilesToDrive } from '../../../drive/server/utils/drive-save'
import type { DriveFileHistory, DriveSavePort } from '../../../drive/server/utils/drive-save'
import { resolveMimeType } from '../../../core/shared/mime'
import { formatMoney, parseMoney } from '../../../payments/shared/money'
import { splitAmount } from '../../../payments/shared/split'
import { matchPayment } from '../../../payments/shared/match'
import type { OpenRequest } from '../../../payments/shared/match'
import { parsePaypalReceivedMail } from '../../../payments/shared/paypal-mail'
import {
  extractLoginCode,
  extractWithRegex,
  renderTemplate
} from '../../shared/extractors'
import { matchesMimeGlob } from '../../shared/mime'
import type { AutomationApplier } from './engine'

/** The domains a PayPal payment mail must be DKIM-signed for */
export const PAYPAL_SIGNING_DOMAINS = ['paypal.de', 'paypal.com'] as const

/** What one created payment request looks like to the runner */
export interface CreatedPaymentRequest {
  id: string
  reference: string
  amountCents: number
}

/**
 * The payment operations a request-payment or confirm-paypal-payment action
 * needs. Injected, so the runner can be tested without a database.
 */
export interface PaymentActionPort {
  createRequests(
    service: string,
    input: Array<{
      title: string
      amountCents: number
      payerName: string
      payerEmail?: string
      contactService?: string
      contactUid?: string
    }>,
    options: { batchId: string, origin: string }
  ): Promise<CreatedPaymentRequest[]>
  sendRequest(id: string): Promise<void>
  openRequests(service: string): Promise<OpenRequest[]>
  /** The PayPal addresses the payee receives on, lower-cased; empty when none is set */
  payeePaypalEmails(service: string): Promise<string[]>
  markPaid(id: string, input: { cents: number, via: 'paypal', source: string }): Promise<boolean>
  getRequest(id: string): Promise<{ status: 'open' | 'paid' | 'cancelled', paidCents: number } | undefined>
  /** The request a mail source was already recorded on, so a rerun changes nothing */
  paidRequestForSource(service: string, source: string): Promise<{ requestId: string, reference: string } | undefined>
}

/** What the runner needs besides the actions and the item */
export interface ActionRunContext {
  /** The workflow's name, available to templates as `{{workflow}}` */
  workflow?: string
  /** The run's id; payment requests record where they came from as `workflow:<id>` */
  runId?: string
  /** The clock a modal's expiry is based on; defaults to the real one */
  now?: () => Date
  /** The item's attachments with their bytes; a domain without any returns an empty list */
  itemFiles?: (item: AutomationItem) => Promise<Array<FileSourceMeta & { content: Uint8Array }>>
  /** The drive a save-to-drive action writes to */
  drive?: DriveSavePort
  /** The content record of already saved files, so each body is saved once */
  driveHistory?: DriveFileHistory
  /** Renews a long run's lease before each upload; a lost lease stops the save */
  onBeforeUpload?: () => Promise<void> | void
  /** The payment requests and matching a payment action uses */
  payments?: PaymentActionPort
  /**
   * Verifies that the mail's sender really signed it for one of `check.domains`
   * and, when `check.recipients` names any, that it was addressed to one of
   * them, and reads its HTML body from the same fetch — PayPal's payment mails
   * are often HTML only, so the plain text an item carries is not enough.
   */
  verifyMailSender?: (service: string, mailbox: string, uid: number, check: MailSenderCheck) => Promise<VerifiedMail>
  /** Asks the owner to look at a payment that could not be confirmed automatically */
  announcePaymentReview?: (input: { service: string, itemKey: string, title: string, body: string }) => Promise<void> | void
}

/** What a sender check is measured against */
export interface MailSenderCheck {
  /** The domains the signature must be for */
  domains: readonly string[]
  /**
   * The mailboxes the mail must be addressed to, so a forwarded mail does not
   * count. Absent when the payee names none, which leaves the recipient
   * unchecked.
   */
  recipients?: readonly string[]
}

/** What a sender check answers, beside the body the same fetch already read */
export interface VerifiedMail {
  ok: boolean
  reason?: string
  /** The Subject of the verified source, which the signature covers */
  subject?: string
  /** The HTML body, present only for a verified mail */
  html?: string
}

export interface ActionRunResult {
  /** What was actually done, with the information a reversal needs */
  applied: AppliedAction[]
  /** The item after every action, e.g. a mail with its new uid after a move */
  item: AutomationItem
  /** The variables the run extracted */
  variables: Record<string, string>
}

/**
 * The text an extract action reads. `subject` is the mail subject (documents have
 * none, so it stays empty); `text` is the body the engine also reads.
 */
function sourceText(item: AutomationItem, action: ExtractAction): string {
  if (action.source === 'subject') {
    return item.fields.subject ?? ''
  }
  return item.fields.text || item.state || ''
}

/** The value an extract action reads, or `undefined` when there is none */
export function extractValue(action: ExtractAction, item: AutomationItem): string | undefined {
  const text = sourceText(item, action)
  if (action.extractor === 'login-code') {
    return extractLoginCode(text)
  }
  return action.pattern ? extractWithRegex(action.pattern, text) : undefined
}

/** The values every template may use, resolved from the item and the run */
function templateValues(item: AutomationItem, workflow: string | undefined, variables: Record<string, string>) {
  return {
    title: item.title,
    subject: item.fields.subject ?? '',
    from: item.fields.from ?? '',
    workflow: workflow ?? '',
    ...variables
  }
}

/** The applied record of a notify action, with its modal text already rendered */
function renderNotify(action: NotifyAction, nodeId: string, values: Record<string, string>, now: Date): Extract<AppliedAction, { type: 'notify' }> {
  const modal = action.modal
    ? {
        title: action.modal.title ? renderTemplate(action.modal.title, values) : undefined,
        text: renderTemplate(action.modal.text, values),
        copy: action.modal.copy ?? false,
        expiresAt: action.modal.expiresInMinutes
          ? new Date(now.getTime() + action.modal.expiresInMinutes * 60_000).toISOString()
          : undefined
      }
    : undefined

  return {
    type: 'notify',
    nodeId,
    title: renderTemplate(action.title, values),
    body: action.body !== undefined ? renderTemplate(action.body, values) : undefined,
    modal
  }
}

/**
 * Saves the item's attachments the action accepts into its drive folder. With the
 * duplicate check on (the default) a file whose bytes were already saved into the
 * folder is skipped, whatever its name, so the same video arriving in several mails
 * is stored once, and a file already there by name and size is skipped too — that
 * catches files put there by hand. With it off, both skips are gone: the same bytes
 * are stored again and a same-name file is renamed or skipped as the action asks.
 * The content record is written either way, so turning the check back on later
 * knows the file. No matching file is not an error: the run still records that
 * nothing matched, so the activity list can tell it from a save that skipped
 * every file.
 */
async function saveToDrive(
  action: SaveToDriveAction,
  item: AutomationItem,
  context: ActionRunContext
): Promise<Extract<AppliedAction, { type: 'save-to-drive' }>> {
  if (!context.itemFiles) {
    throw new Error('Saving attachments is not available for this item')
  }

  const files = (await context.itemFiles(item))
    .map((file) => {
      const contentType = resolveMimeType(file.contentType, file.filename)
      return { ...file, contentType }
    })
    .filter(file => matchesMimeGlob(file.contentType, action.accept, file.filename))
  if (!files.length) {
    return { type: 'save-to-drive', service: action.service, paths: [], skipped: [], matched: 0 }
  }

  if (!context.drive) {
    throw new Error('Saving attachments to a drive is not available')
  }
  if (!context.driveHistory) {
    throw new Error('Tracking saved attachments is not available')
  }
  // A stored graph may hold a hand-written folder, e.g. `Public/salsa`
  const folder = normalizeDriveFolderInput(action.folder) ?? action.folder

  const result = await saveFilesToDrive(action.service, folder, files, {
    conflict: action.conflict ?? 'rename',
    checkDuplicates: action.checkDuplicates !== false,
    onBeforeUpload: context.onBeforeUpload
  }, {
    drive: context.drive,
    history: context.driveHistory
  })

  return {
    type: 'save-to-drive',
    service: action.service,
    paths: result.saved,
    skipped: result.skipped,
    matched: files.length
  }
}

/**
 * Renders a payment split and creates one request per payer, optionally sending
 * them. A failed send leaves the request in place and is visible as an id missing
 * from `sent`; only a missing or non-positive total stops the chain.
 */
async function requestPayment(
  action: RequestPaymentAction,
  item: AutomationItem,
  context: ActionRunContext,
  variables: Record<string, string>
): Promise<Extract<AppliedAction, { type: 'request-payment' }>> {
  const values = templateValues(item, context.workflow, variables)
  const rendered = renderTemplate(action.amount, values).trim()
  const total = parseMoney(rendered)
  if (total === undefined) {
    throw new Error(`The payment amount "${rendered}" is not a positive amount`)
  }
  if (!context.payments) {
    throw new Error('Payment requests are not available for this item')
  }

  const amounts = splitAmount(total, action.shares, action.payers.length)
  const title = renderTemplate(action.title, values).trim() || item.title
  const created = await context.payments.createRequests(
    action.payee,
    action.payers.map((payer: PaymentPayer, index) => ({
      title,
      amountCents: amounts[index]!,
      payerName: payer.name,
      payerEmail: payer.email,
      contactService: payer.contactService,
      contactUid: payer.contactUid
    })),
    { batchId: randomUUID(), origin: `workflow:${context.runId ?? 'unknown'}` }
  )

  const sent: string[] = []
  if (action.send) {
    for (const request of created) {
      try {
        await context.payments.sendRequest(request.id)
        sent.push(request.id)
      } catch {
        // The request exists either way; the applied record shows which mails went out
      }
    }
  }

  variables.paymentTotal = formatMoney(total)
  variables.paymentShare = formatMoney(amounts[0]!)
  variables.paymentReferences = created.map(request => request.reference).join(', ')

  return { type: 'request-payment', requestIds: created.map(request => request.id), sent }
}

/** Asks the owner to look at a mail the action could not turn into a payment */
async function announcePaymentReview(
  context: ActionRunContext,
  item: AutomationItem,
  title: string,
  body: string
): Promise<void> {
  try {
    await context.announcePaymentReview?.({ service: item.service, itemKey: item.key, title, body })
  } catch {
    // The notification is a convenience; it must not fail the run
  }
}

/**
 * Confirms a PayPal "money received" mail. Only a mail whose sender signature
 * verifies for PayPal's own domain may change a payment. When the payee names
 * its own PayPal addresses, the mail must also be addressed to one of them — a
 * genuine mail to another account keeps its signature when it is forwarded, so
 * the recipient is part of the check wherever it is known. Everything else is
 * recorded for the owner, so a forged or redirected mail can never mark a
 * request paid.
 */
async function confirmPaypalPayment(
  action: ConfirmPaypalPaymentAction,
  item: AutomationItem,
  context: ActionRunContext,
  variables: Record<string, string>
): Promise<Extract<AppliedAction, { type: 'confirm-paypal-payment' }>> {
  if (item.domain !== 'mail' || !item.mailbox || item.uid === undefined) {
    throw new Error('Confirming a PayPal payment needs a mail item')
  }
  if (!context.payments) {
    throw new Error('Matching payments is not available for this item')
  }

  // Without the payee's own PayPal addresses the recipient cannot be checked;
  // the signature check stays, and no recipients are handed over rather than an
  // empty list, which would match nothing
  const recipients = await context.payments.payeePaypalEmails(action.payee)

  const verified: VerifiedMail = context.verifyMailSender
    ? await context.verifyMailSender(item.service, item.mailbox, item.uid, {
        domains: PAYPAL_SIGNING_DOMAINS,
        ...(recipients.length ? { recipients } : {})
      })
    : { ok: false, reason: 'sender verification is not available' }

  if (!verified.ok) {
    await announcePaymentReview(
      context,
      item,
      'PayPal payment not confirmed',
      `${item.title} — the mail could not be verified as a PayPal payment (${verified.reason ?? 'no valid signature'}). Mark the right request paid by hand.`
    )
    return { type: 'confirm-paypal-payment', outcome: 'unverified' }
  }

  const parsed = parsePaypalReceivedMail({
    // The subject of the source that was verified, not the one the item was
    // indexed with: only the verified headers are the ones the signature covers
    subject: verified.subject ?? item.fields.subject ?? '',
    text: item.fields.text || item.state || '',
    html: verified.html
  })
  if (!parsed) {
    return { type: 'confirm-paypal-payment', outcome: 'not-a-payment' }
  }

  // The same payment can arrive in two mails or be judged again later, so
  // PayPal's own id names the receipt whenever the mail carries one. Without it
  // the mail itself is the receipt.
  const mailSource = `paypal-mail:${item.service}:${item.messageId ?? `${item.mailbox}/${item.uid}`}`
  const source = parsed.transactionId ? `paypal:${parsed.transactionId}` : mailSource
  // A request paid from this very mail before the id was read keeps its old
  // source, so both are looked up: what was recorded decides, not the key.
  const recorded = await context.payments.paidRequestForSource(item.service, source)
    ?? (source === mailSource
      ? undefined
      : await context.payments.paidRequestForSource(item.service, mailSource))
  if (recorded) {
    variables.paymentReference = recorded.reference
    variables.paymentPayer = parsed.payerName
    variables.paymentAmount = formatMoney(parsed.amountCents)
    return {
      type: 'confirm-paypal-payment',
      outcome: 'already-paid',
      requestId: recorded.requestId,
      cents: parsed.amountCents
    }
  }

  const open = await context.payments.openRequests(action.payee)
  const match = matchPayment(open, {
    amountCents: parsed.amountCents,
    payerName: parsed.payerName,
    text: parsed.note
  })

  if (match.kind === 'ambiguous' || match.kind === 'none') {
    const reason = match.kind === 'ambiguous'
      ? `Several open requests match ${parsed.payerName} and ${formatMoney(parsed.amountCents)}.`
      : `No open request matches ${parsed.payerName} and ${formatMoney(parsed.amountCents)}.`
    await announcePaymentReview(
      context,
      item,
      'PayPal payment needs a look',
      `${item.title} — ${reason} Mark the right request paid by hand.`
    )
    return { type: 'confirm-paypal-payment', outcome: match.kind }
  }

  const request = match.request
  const paid = await context.payments.markPaid(request.id, {
    cents: parsed.amountCents,
    via: 'paypal',
    source
  })
  const after = await context.payments.getRequest(request.id)

  variables.paymentReference = request.reference
  variables.paymentPayer = parsed.payerName
  variables.paymentAmount = formatMoney(parsed.amountCents)

  // A rerun of the same mail (or a request closed meanwhile) changes nothing and
  // must not offer an undo that would reopen the original payment
  if (!paid) {
    return { type: 'confirm-paypal-payment', outcome: 'already-paid', requestId: request.id, cents: parsed.amountCents }
  }

  return {
    type: 'confirm-paypal-payment',
    outcome: 'paid',
    requestId: request.id,
    cents: parsed.amountCents,
    paidCents: after?.paidCents
  }
}

/**
 * Runs a workflow's actions in order. Generic actions (`extract`, `notify`,
 * `save-to-drive`, `request-payment`, `confirm-paypal-payment`) are handled here;
 * every domain action is handed to the domain applier one at a time, carrying the
 * item it returns forward, so a mail's new uid after a move reaches the next
 * action. An `extract` that finds nothing throws, which stops the run before the
 * following actions — a trash after a failed extract never happens. A save-to-drive
 * that fails likewise stops the chain, so a following trash only runs once the
 * files are on the drive.
 */
export async function runActions(
  actions: PlannedAction[],
  item: AutomationItem,
  applier: AutomationApplier,
  context: ActionRunContext = {}
): Promise<ActionRunResult> {
  let current = item
  const applied: AppliedAction[] = []
  const variables: Record<string, string> = {}
  const now = context.now?.() ?? new Date()

  for (const planned of actions) {
    const action = planned.action

    if (action.type === 'extract') {
      const value = extractValue(action, current)
      if (value === undefined) {
        throw new Error(`No ${action.variable} found`)
      }
      variables[action.variable] = value
      applied.push({ type: 'extract', variable: action.variable, value })
      continue
    }

    if (action.type === 'notify') {
      applied.push(renderNotify(action, planned.nodeId, templateValues(current, context.workflow, variables), now))
      continue
    }

    if (action.type === 'save-to-drive') {
      applied.push(await saveToDrive(action, current, context))
      continue
    }

    if (action.type === 'request-payment') {
      applied.push(await requestPayment(action, current, context, variables))
      continue
    }

    if (action.type === 'confirm-paypal-payment') {
      applied.push(await confirmPaypalPayment(action, current, context, variables))
      continue
    }

    const result = await applier.apply([action], current)
    applied.push(...result.applied)
    current = result.item
  }

  return { applied, item: current, variables }
}
