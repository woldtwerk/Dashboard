import { z } from 'zod'
import type { MailSettings } from '../../shared/types/settings'
import { normalizeTrustedImageSender } from '../../shared/mail-images'
import { normalizeSenderAddress, SENDER_ADDRESSES_MAX } from '../../shared/mail-sender-addresses'

/** At most this many senders/domains may be trusted; every one was added by hand */
export const TRUSTED_IMAGE_SENDERS_MAX = 1000

const trustedImageSender = z.string().transform((value, context) => {
  const normalized = normalizeTrustedImageSender(value)
  if (!normalized) {
    context.addIssue({
      code: 'custom',
      message: `"${value}" is not an email address or a domain such as @example.com`
    })
    return z.NEVER
  }
  return normalized
})

const senderAddress = z.string().transform((value, context) => {
  const normalized = normalizeSenderAddress(value)
  if (!normalized) {
    context.addIssue({
      code: 'custom',
      message: `"${value}" is not an email address`
    })
    return z.NEVER
  }
  return normalized
})

export const mailSettingsSchema = z.object({
  trustedImageSenders: z.array(trustedImageSender).max(TRUSTED_IMAGE_SENDERS_MAX),
  listView: z.enum(['mails', 'conversations']),
  senderAddresses: z.record(z.string().min(1), z.array(senderAddress).max(SENDER_ADDRESSES_MAX)).default({})
})

export const mailSettingsDefaults: MailSettings = {
  trustedImageSenders: [],
  listView: 'mails',
  senderAddresses: {}
}
