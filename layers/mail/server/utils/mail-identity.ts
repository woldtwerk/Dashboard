import { normalizeEmail } from '../../../core/shared/entities'

/**
 * The mail account's own address, as the conversation view and the mail
 * importance rule need it. Every mail connector stores its login in `user`;
 * Proton Bridge reports the account's address there.
 */
export async function mailOwnAddress(serviceId: string): Promise<string | undefined> {
  const { values } = await getService(serviceId, 'mail')
  return normalizeEmail(typeof values.user === 'string' ? values.user : undefined)
}
