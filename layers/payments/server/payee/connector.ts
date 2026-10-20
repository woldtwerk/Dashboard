import type { Connector } from '../../../core/server/utils/services'
import type { SetupValues } from '../../../core/shared/types/setup'
import { isValidIban, normalizeIban } from '../../shared/iban'
import { isValidPaypalUsername } from '../../shared/paypal'

function text(value: SetupValues[string]): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The payee connector: whose account receives the payments and from which mail
 * account the requests go out. Every value is non-secret, so the wizard stores
 * them through the encrypted service values without a password field.
 */
export function createPayeeConnector(): Connector {
  return {
    id: 'payee',
    domain: 'payments',
    title: 'Payee',
    description: 'Bank details, PayPal.me and Wero the payment requests point at.',
    icon: 'i-lucide-hand-coins',

    wizard: {
      steps: [{
        id: 'payee',
        title: 'Payee',
        description: 'Where the money goes',
        icon: 'i-lucide-hand-coins',
        intro: 'The account that receives the payments. Every request carries these details as a GiroCode and, when set, a PayPal.me link.',
        fields: [
          {
            name: 'holder',
            label: 'Account holder',
            type: 'text',
            required: true,
            placeholder: 'Max Mustermann'
          },
          {
            name: 'iban',
            label: 'IBAN',
            type: 'text',
            required: true,
            placeholder: 'DE89 3704 0044 0532 0130 00'
          },
          {
            name: 'bic',
            label: 'BIC',
            type: 'text',
            placeholder: 'COBADEFFXXX',
            description: 'Optional for SEPA transfers inside the EU'
          },
          {
            name: 'paypalMe',
            label: 'PayPal.me username',
            type: 'text',
            placeholder: 'maxmustermann',
            description: 'Letters and digits only, as in paypal.me/username'
          },
          {
            name: 'wero',
            label: 'Wero',
            type: 'text',
            placeholder: '+49 170 1234567',
            description: 'Phone number or email registered with Wero'
          },
          {
            name: 'mailService',
            label: 'Mail account',
            type: 'select',
            required: true,
            dynamic: true,
            description: 'Payment requests are sent from this account'
          }
        ]
      }]
    },

    async complete(values: SetupValues): Promise<SetupValues> {
      const bic = text(values.bic).toUpperCase()
      const paypalMe = text(values.paypalMe)
      const wero = text(values.wero)

      return {
        holder: text(values.holder),
        iban: normalizeIban(text(values.iban)),
        bic: bic || undefined,
        paypalMe: paypalMe || undefined,
        wero: wero || undefined,
        mailService: text(values.mailService)
      }
    },

    validate(values: SetupValues) {
      if (!text(values.holder)) {
        return 'The account holder is required'
      }
      if (!isValidIban(text(values.iban))) {
        return 'Enter a valid IBAN'
      }
      const paypalMe = text(values.paypalMe)
      if (paypalMe && !isValidPaypalUsername(paypalMe)) {
        return 'The PayPal.me username may only contain letters and digits'
      }
      if (!text(values.mailService)) {
        return 'Choose the mail account to send from'
      }
    },

    async fieldOptions(field) {
      if (field !== 'mailService') {
        return []
      }

      return (await listServices('mail')).map(service => ({ label: service.name, value: service.id }))
    }
  }
}
