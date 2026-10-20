import type {
  AutomationAction,
  AutomationCondition,
  AutomationDomain,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode
} from './types/automation'
import type { WorkflowValidationError } from './workflow'

/**
 * The templates the automation page offers. Every graph is a complete, valid
 * workflow. Mail templates are ready to run as they are; document templates refer
 * to a tag or document type by name, which is resolved against the archive when
 * the template is instantiated (see {@link instantiateWorkflowTemplate}).
 */

/** A named reference that is resolved when a template becomes a workflow */
export type WorkflowTemplateBinding
  = | { nodeId: string, kind: 'tag', name: string }
    | { nodeId: string, kind: 'documentType', name: string }

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  domain: AutomationDomain
  icon: string
  graph: WorkflowGraph
  /** Actions whose provider id is only known once the target archive is known */
  bindings: WorkflowTemplateBinding[]
  /**
   * The graph is deliberately incomplete until the user picks a required value
   * (a drive service and folder, say): it is stored disabled and stays invalid,
   * so it cannot be enabled by accident.
   */
  requiresSetup?: boolean
}

/** The names an archive knows, used to resolve a template's bindings */
export interface WorkflowTemplateCatalogue {
  tags: Array<{ id: number, name: string }>
  documentTypes: Array<{ id: number, name: string }>
}

export interface InstantiatedWorkflowTemplate {
  graph: WorkflowGraph
  /** A binding whose name the archive does not know; the node is left unresolved */
  errors: WorkflowValidationError[]
}

// --- Graph constructors ---------------------------------------------------

function triggerNode(mailbox: string, x: number, y: number): WorkflowNode {
  return { id: 'trigger', type: 'trigger', position: { x, y }, data: { kind: 'new-item', mailbox } }
}

function conditionNode(
  id: string,
  conditions: AutomationCondition[],
  combine: 'all' | 'any',
  x: number,
  y: number
): WorkflowNode {
  return { id, type: 'condition', position: { x, y }, data: { conditions: { combine, conditions } } }
}

function choiceNode(
  id: string,
  instructions: string,
  options: Record<string, string>,
  thresholds: Record<string, number>,
  x: number,
  y: number
): WorkflowNode {
  return { id, type: 'decision', position: { x, y }, data: { question: 'choice', instructions, options, thresholds } }
}

function yesnoNode(id: string, instructions: string, yes: number, no: number, x: number, y: number): WorkflowNode {
  return { id, type: 'decision', position: { x, y }, data: { question: 'yesno', instructions, thresholds: { yes, no } } }
}

function actionNode(id: string, action: AutomationAction, x: number, y: number): WorkflowNode {
  return { id, type: 'action', position: { x, y }, data: { action } }
}

function endNode(x: number, y: number): WorkflowNode {
  return { id: 'end', type: 'end', position: { x, y }, data: {} }
}

function edge(source: string, sourceHandle: string, target: string): WorkflowEdge {
  return { id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target }
}

function graph(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowGraph {
  return { version: 1, nodes, edges }
}

const contains = (field: AutomationCondition['field'], value: string): AutomationCondition => ({ field, op: 'contains', value })

/** A named sender, so a condition reads `From contains …` */
const from = (value: string) => contains('from', value)
const subject = (value: string) => contains('subject', value)
const text = (value: string) => contains('text', value)

// --- Mail templates -------------------------------------------------------

const invoiceReceipts: WorkflowTemplate = {
  id: 'mail-invoices-receipts',
  name: 'Label invoices & receipts',
  description: 'Labels invoices as Rechnungen and receipts or order confirmations as Bestellungen. Proton keeps labels under Labels/; a label that does not exist yet is created on first apply.',
  domain: 'mail',
  icon: 'i-lucide-receipt',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    choiceNode(
      'kind',
      'Which of these fits the mail best?',
      {
        invoice: 'Asks for money to be paid: a bill, invoice or payment reminder (Rechnung, Zahlungserinnerung, Mahnung)',
        receipt: 'Confirms something already bought or paid: an order confirmation, receipt or shipping notice for a purchase',
        other: 'Neither: private mail, newsletters, notifications, security advisories or marketing'
      },
      { invoice: 0.8, receipt: 0.8, other: 0.5 },
      0,
      140
    ),
    actionNode('label-invoice', { type: 'label', label: 'Rechnungen' }, 0, 280),
    actionNode('label-receipt', { type: 'label', label: 'Bestellungen' }, 320, 280),
    endNode(640, 280)
  ], [
    edge('trigger', 'next', 'kind'),
    edge('kind', 'invoice', 'label-invoice'),
    edge('kind', 'receipt', 'label-receipt'),
    // The third option in the question is the implicit `other` output.
    edge('kind', 'other', 'end'),
    edge('label-invoice', 'next', 'end'),
    edge('label-receipt', 'next', 'end')
  ]),
  bindings: []
}

const socialMedia: WorkflowTemplate = {
  id: 'mail-social-media',
  name: 'Social media notifications',
  description: 'Finds automated posts from social networks by sender or by asking the local model, then labels them Social and marks them read. A label that does not exist yet is created on first apply.',
  domain: 'mail',
  icon: 'i-lucide-share-2',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    conditionNode('looks-social', [
      from('facebook'),
      from('instagram'),
      from('linkedin'),
      from('x.com'),
      from('twitter'),
      from('tiktok'),
      from('youtube'),
      from('reddit'),
      from('mastodon')
    ], 'any', 0, 140),
    actionNode('label-social-sender', { type: 'label', label: 'Social' }, 0, 280),
    actionNode('read-social-sender', { type: 'mark-read' }, 0, 420),
    yesnoNode('automated', 'Is this an automated notification from a social network?', 0.85, 0.85, 320, 280),
    actionNode('label-social-ai', { type: 'label', label: 'Social' }, 320, 420),
    actionNode('read-social-ai', { type: 'mark-read' }, 320, 560),
    endNode(640, 420)
  ], [
    edge('trigger', 'next', 'looks-social'),
    edge('looks-social', 'true', 'label-social-sender'),
    edge('looks-social', 'false', 'automated'),
    edge('automated', 'yes', 'label-social-ai'),
    edge('automated', 'no', 'end'),
    edge('automated', 'unsure', 'end'),
    edge('label-social-sender', 'next', 'read-social-sender'),
    edge('read-social-sender', 'next', 'end'),
    edge('label-social-ai', 'next', 'read-social-ai'),
    edge('read-social-ai', 'next', 'end')
  ]),
  bindings: []
}

const adsNewsletters: WorkflowTemplate = {
  id: 'mail-ads-newsletters',
  name: 'Ads & newsletters',
  description: 'Separates advertising and subscribed newsletters from personal and transactional mail and labels them Werbung or Newsletter. A label that does not exist yet is created on first apply.',
  domain: 'mail',
  icon: 'i-lucide-megaphone',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    choiceNode(
      'kind',
      'Is this mail advertising/marketing, a newsletter the user subscribed to, or personal/transactional?',
      {
        ads: 'Advertising or marketing for a product or service: promotions, sales and discount offers',
        newsletter: 'A newsletter the user subscribed to, with recurring editorial content',
        other: 'Neither: private mail, transactional mail, invoices, notifications or security advisories'
      },
      { ads: 0.85, newsletter: 0.8, other: 0.5 },
      0,
      140
    ),
    actionNode('label-ads', { type: 'label', label: 'Werbung' }, 0, 280),
    actionNode('read-ads', { type: 'mark-read' }, 0, 420),
    actionNode('label-newsletter', { type: 'label', label: 'Newsletter' }, 320, 280),
    endNode(640, 280)
  ], [
    edge('trigger', 'next', 'kind'),
    edge('kind', 'ads', 'label-ads'),
    edge('kind', 'newsletter', 'label-newsletter'),
    edge('kind', 'other', 'end'),
    edge('label-ads', 'next', 'read-ads'),
    edge('read-ads', 'next', 'end'),
    edge('label-newsletter', 'next', 'end')
  ]),
  bindings: []
}

const securityUpdates: WorkflowTemplate = {
  id: 'mail-security-updates',
  name: 'Security updates',
  description: 'Watches the Drupal security feed and messages whose subject looks like a security notice, stars critical ones and labels them all Security. A label that does not exist yet is created on first apply.',
  domain: 'mail',
  icon: 'i-lucide-shield-alert',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    conditionNode('security-signal', [
      from('security-news@drupal.org'),
      subject('security'),
      subject('Sicherheit'),
      subject('CVE'),
      subject('advisory')
    ], 'any', 0, 140),
    choiceNode(
      'severity',
      'How severe is this security notice?',
      {
        critical: 'Critical, remotely exploitable or already exploited in the wild',
        high: 'High severity, exploitable with some effort or prerequisites',
        moderate: 'Moderate severity with limited impact or hard prerequisites',
        low: 'Low severity or purely informational',
        other: 'Not a security notice, or no severity can be told from the text'
      },
      { critical: 0.6, high: 0.5, moderate: 0.5, low: 0.5, other: 0.5 },
      0,
      280
    ),
    actionNode('star-critical', { type: 'star' }, 0, 420),
    actionNode('label-security', { type: 'label', label: 'Security' }, 320, 560),
    endNode(640, 560)
  ], [
    edge('trigger', 'next', 'security-signal'),
    edge('security-signal', 'true', 'severity'),
    edge('security-signal', 'false', 'end'),
    edge('severity', 'critical', 'star-critical'),
    edge('severity', 'high', 'label-security'),
    edge('severity', 'moderate', 'label-security'),
    edge('severity', 'low', 'label-security'),
    edge('severity', 'other', 'label-security'),
    edge('star-critical', 'next', 'label-security'),
    edge('label-security', 'next', 'end')
  ]),
  bindings: []
}

const shipping: WorkflowTemplate = {
  id: 'mail-shipping',
  name: 'Shipping & delivery',
  description: 'Labels shipping and delivery status updates Lieferungen. A label that does not exist yet is created on first apply.',
  domain: 'mail',
  icon: 'i-lucide-truck',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    yesnoNode('shipping', 'Is this a shipping/delivery status update?', 0.85, 0.85, 0, 140),
    actionNode('label-shipping', { type: 'label', label: 'Lieferungen' }, 0, 280),
    endNode(320, 280)
  ], [
    edge('trigger', 'next', 'shipping'),
    edge('shipping', 'yes', 'label-shipping'),
    edge('shipping', 'no', 'end'),
    edge('shipping', 'unsure', 'end'),
    edge('label-shipping', 'next', 'end')
  ]),
  bindings: []
}

const calendarInvitations: WorkflowTemplate = {
  id: 'mail-calendar-invitations',
  name: 'Calendar invitations',
  description: 'Stars calendar invitations and .ics attachments so they are easy to find.',
  domain: 'mail',
  icon: 'i-lucide-calendar-check',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    conditionNode('invitation', [
      subject('Einladung'),
      subject('invitation'),
      text('Einladung'),
      text('invitation'),
      text('.ics')
    ], 'any', 0, 140),
    actionNode('star-invitation', { type: 'star' }, 0, 280),
    endNode(320, 280)
  ], [
    edge('trigger', 'next', 'invitation'),
    edge('invitation', 'true', 'star-invitation'),
    edge('invitation', 'false', 'end'),
    edge('star-invitation', 'next', 'end')
  ]),
  bindings: []
}

const loginCodes: WorkflowTemplate = {
  id: 'mail-login-codes',
  name: 'Login codes',
  description: 'Extracts the one-time login or verification code from a mail, sends a notification with it in a pop-up that has a copy button, and moves the mail to the trash. Mail without a recognisable code stays where it is. Created disabled and in suggest mode; it is meant to run in automatic mode.',
  domain: 'mail',
  icon: 'i-lucide-key-round',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    yesnoNode(
      'is-code',
      'Is this mail a one-time login, sign-in, verification or two-factor authentication code (OTP, TAN, security token) sent to the user right now?',
      0.8,
      0.8,
      0,
      140
    ),
    actionNode('extract-code', { type: 'extract', variable: 'code', extractor: 'login-code' }, 0, 280),
    actionNode('notify-code', {
      type: 'notify',
      title: 'Login code from {{from}}',
      body: '{{subject}}',
      modal: { title: 'Login code', text: '{{code}}', copy: true, expiresInMinutes: 15 }
    }, 0, 420),
    actionNode('trash', { type: 'trash' }, 0, 560),
    endNode(320, 560)
  ], [
    edge('trigger', 'next', 'is-code'),
    edge('is-code', 'yes', 'extract-code'),
    edge('is-code', 'no', 'end'),
    edge('is-code', 'unsure', 'end'),
    edge('extract-code', 'next', 'notify-code'),
    edge('notify-code', 'next', 'trash'),
    edge('trash', 'next', 'end')
  ]),
  bindings: []
}

const attachmentsToDrive: WorkflowTemplate = {
  id: 'mail-attachments-to-drive',
  name: 'Move attachments to drive',
  description: 'Saves every attachment of a mail to a folder in your drive and moves the mail to the trash once the upload succeeded. Pick the drive service and folder on the save action; until you do, the workflow stays invalid and cannot be enabled.',
  domain: 'mail',
  icon: 'i-lucide-hard-drive-upload',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    actionNode('save-attachments', {
      type: 'save-to-drive',
      service: '',
      folder: '',
      accept: [],
      conflict: 'rename'
    }, 0, 140),
    actionNode('trash', { type: 'trash' }, 0, 280),
    endNode(320, 280)
  ], [
    edge('trigger', 'next', 'save-attachments'),
    edge('save-attachments', 'next', 'trash'),
    edge('trash', 'next', 'end')
  ]),
  bindings: [],
  requiresSetup: true
}

// --- Document templates ---------------------------------------------------
const classifyInvoices: WorkflowTemplate = {
  id: 'documents-classify',
  name: 'Classify invoices',
  description: 'Classifies documents and sets the matching document type plus the auto tag. Types and tags are matched by name when the template is added; a name your archive does not have is a validation error until you pick one.',
  domain: 'documents',
  icon: 'i-lucide-files',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    choiceNode(
      'kind',
      'What kind of document is this: invoice, contract, payslip, certificate, letter, or anything else?',
      {
        invoice: 'Asks for money to be paid: a bill or invoice (Rechnung), incl. payment reminders',
        contract: 'A contract or agreement between parties',
        payslip: 'A payslip, salary statement or wage statement',
        certificate: 'A certificate, diploma or official record',
        letter: 'A letter or other written correspondence',
        other: 'None of these: receipts, tax assessments, forms, manuals or photos'
      },
      { invoice: 0.8, contract: 0.8, payslip: 0.8, certificate: 0.8, letter: 0.8, other: 0.5 },
      0,
      140
    ),
    actionNode('type-invoice', { type: 'set-type', documentType: 1 }, 0, 280),
    actionNode('type-contract', { type: 'set-type', documentType: 1 }, 280, 280),
    actionNode('type-payslip', { type: 'set-type', documentType: 1 }, 560, 280),
    actionNode('type-certificate', { type: 'set-type', documentType: 1 }, 840, 280),
    actionNode('type-letter', { type: 'set-type', documentType: 1 }, 1120, 280),
    actionNode('tag-auto', { type: 'add-tag', tag: 1 }, 0, 420),
    endNode(320, 560)
  ], [
    edge('trigger', 'next', 'kind'),
    edge('kind', 'invoice', 'type-invoice'),
    edge('kind', 'contract', 'type-contract'),
    edge('kind', 'payslip', 'type-payslip'),
    edge('kind', 'certificate', 'type-certificate'),
    edge('kind', 'letter', 'type-letter'),
    // `other` is the question's implicit sixth option: no type to set.
    edge('kind', 'other', 'end'),
    edge('type-invoice', 'next', 'tag-auto'),
    edge('type-contract', 'next', 'tag-auto'),
    edge('type-payslip', 'next', 'tag-auto'),
    edge('type-certificate', 'next', 'tag-auto'),
    edge('type-letter', 'next', 'tag-auto'),
    edge('tag-auto', 'next', 'end')
  ]),
  bindings: [
    { nodeId: 'type-invoice', kind: 'documentType', name: 'Invoice' },
    { nodeId: 'type-contract', kind: 'documentType', name: 'Contract' },
    { nodeId: 'type-payslip', kind: 'documentType', name: 'Payslip' },
    { nodeId: 'type-certificate', kind: 'documentType', name: 'Certificate' },
    { nodeId: 'type-letter', kind: 'documentType', name: 'Letter' },
    { nodeId: 'tag-auto', kind: 'tag', name: 'auto' }
  ]
}

const taxRelevant: WorkflowTemplate = {
  id: 'documents-tax',
  name: 'Tag tax relevant',
  description: 'Tags documents that are relevant for the income tax return with Steuer. The tag is matched by name when the template is added; if your archive does not have it yet, pick one on the action.',
  domain: 'documents',
  icon: 'i-lucide-calculator',
  graph: graph([
    triggerNode('INBOX', 0, 0),
    yesnoNode('tax', 'Is this document relevant for the income tax return?', 0.8, 0.8, 0, 140),
    actionNode('tag-tax', { type: 'add-tag', tag: 1 }, 0, 280),
    endNode(320, 280)
  ], [
    edge('trigger', 'next', 'tax'),
    edge('tax', 'yes', 'tag-tax'),
    edge('tax', 'no', 'end'),
    edge('tax', 'unsure', 'end'),
    edge('tag-tax', 'next', 'end')
  ]),
  bindings: [
    { nodeId: 'tag-tax', kind: 'tag', name: 'Steuer' }
  ]
}

export const workflowTemplates: WorkflowTemplate[] = [
  invoiceReceipts,
  socialMedia,
  adsNewsletters,
  securityUpdates,
  shipping,
  calendarInvitations,
  loginCodes,
  attachmentsToDrive,
  classifyInvoices,
  taxRelevant
]

// --- Instantiation --------------------------------------------------------

function resolveByName(entries: Array<{ id: number, name: string }>, name: string) {
  const needle = name.trim().toLocaleLowerCase()
  return entries.find(entry => entry.name.trim().toLocaleLowerCase() === needle)
}

/**
 * Resolves a template's name bindings against one archive. A name that is not in
 * the catalogue leaves the action at an invalid id (0), so the builder shows a
 * validation error until the user picks a real tag or document type.
 */
export function instantiateWorkflowTemplate(
  template: WorkflowTemplate,
  catalogue: WorkflowTemplateCatalogue
): InstantiatedWorkflowTemplate {
  const copy = structuredClone(template.graph)
  const errors: WorkflowValidationError[] = []

  for (const binding of template.bindings) {
    const node = copy.nodes.find(candidate => candidate.id === binding.nodeId)
    if (!node || node.type !== 'action') {
      continue
    }

    if (binding.kind === 'tag') {
      if (node.data.action.type !== 'add-tag') {
        continue
      }
      const match = resolveByName(catalogue.tags, binding.name)
      node.data.action.tag = match?.id ?? 0
      if (!match) {
        errors.push({ nodeId: binding.nodeId, message: `Tag "${binding.name}" does not exist yet — pick one` })
      }
      continue
    }

    if (node.data.action.type !== 'set-type') {
      continue
    }
    const match = resolveByName(catalogue.documentTypes, binding.name)
    node.data.action.documentType = match?.id ?? 0
    if (!match) {
      errors.push({ nodeId: binding.nodeId, message: `Document type "${binding.name}" does not exist yet — pick one` })
    }
  }

  return { graph: copy, errors }
}
