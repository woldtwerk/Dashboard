import { createError } from 'nuxt/server'
import { isValidIban } from '../../shared/iban'
import { payeeFromValues } from '../../shared/payee'
import type { PayeeDetails } from '../../shared/types/payments'

/**
 * The stored payee settings, normalized. The connector validated them at setup,
 * so an invalid IBAN here means the service was edited or encrypted with another
 * secret; refuse it rather than build a GiroCode that cannot be paid. The old
 * `paypalMe` and free-text Wero values are read into the current shape, so a
 * service set up before the QR fields keeps working without a migration.
 */
export async function usePayee(serviceId: string): Promise<PayeeDetails> {
  const service = await getService(serviceId, 'payments')
  assertSameConnector(service, 'payee')

  const payee = payeeFromValues(service.values)
  if (payee.iban && !isValidIban(payee.iban)) {
    throw createError({ status: 500, statusText: `The IBAN of "${service.name}" is invalid. Set the service up again.` })
  }

  return payee
}
