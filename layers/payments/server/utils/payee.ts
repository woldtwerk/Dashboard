import { createError } from 'nuxt/server'
import { isValidIban, normalizeIban } from '../../shared/iban'
import type { PayeeDetails } from '../../shared/types/payments'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The stored payee settings, normalized. The connector validated them at setup,
 * so an invalid IBAN here means the service was edited or encrypted with another
 * secret; refuse it rather than build a GiroCode that cannot be paid.
 */
export async function usePayee(serviceId: string): Promise<PayeeDetails> {
  const service = await getService(serviceId, 'payments')
  assertSameConnector(service, 'payee')

  const iban = normalizeIban(text(service.values.iban))
  if (!isValidIban(iban)) {
    throw createError({ status: 500, statusText: `The IBAN of "${service.name}" is invalid. Set the service up again.` })
  }

  return {
    holder: text(service.values.holder),
    iban,
    bic: text(service.values.bic) || undefined,
    paypalMe: text(service.values.paypalMe) || undefined,
    wero: text(service.values.wero) || undefined,
    mailService: text(service.values.mailService)
  }
}
