import type { MailSettings } from '#layers/mail/shared/types/settings'
import { addSenderAddress, removeSenderAddress } from '#layers/mail/shared/mail-sender-addresses'

/**
 * The manual From addresses of each mail account, part of the `mail` settings
 * section. Every write sends the whole section, because that is what the
 * settings PUT replaces; `useSettings.save` updates it optimistically.
 */
export function useMailSenderAddresses() {
  const { data, save } = useSettings<MailSettings>('mail')

  const senderAddresses = computed(() => data.value.senderAddresses ?? {})

  function write(next: Record<string, string[]>): Promise<void> {
    return save({ ...data.value, senderAddresses: next })
  }

  /** Add one address to an account; returns the reason when it was not added */
  async function add(serviceId: string, entry: string | null | undefined): Promise<string | undefined> {
    const result = addSenderAddress(senderAddresses.value[serviceId] ?? [], entry)
    if (!result.ok) {
      return result.error
    }

    await write({ ...senderAddresses.value, [serviceId]: result.addresses })
    return undefined
  }

  /** Remove one address from an account; an unknown address changes nothing */
  async function remove(serviceId: string, entry: string): Promise<void> {
    const current = senderAddresses.value[serviceId] ?? []
    const next = removeSenderAddress(current, entry)
    if (next.length !== current.length) {
      await write({ ...senderAddresses.value, [serviceId]: next })
    }
  }

  return { senderAddresses, add, remove }
}
