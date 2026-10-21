import type { Connector } from '../../../core/server/utils/services'
import type { SetupValues } from '../../../core/shared/types/setup'
import { isValidIban, normalizeIban } from '../../shared/iban'
import { isEmailAddress, paypalEmailsFrom } from '../../shared/payee'
import { isValidPaypalTarget, normalizePaypalHandle } from '../../shared/paypal'
import { isValidWeroToken } from '../../shared/wero'

function text(value: SetupValues[string]): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The payee connector: whose account receives the payments and from which mail
 * account the requests go out. Every value is non-secret, so the wizard stores
 * them through the encrypted service values without a password field.
 *
 * A payee does not have to take bank transfers. Any one of an IBAN, a PayPal
 * name/code or a Wero token is enough; the methods that are set are offered in
 * every request, and only those get a QR tab.
 */
export function createPayeeConnector(): Connector {
  return {
    id: 'payee',
    domain: 'payments',
    title: 'Payee',
    description: 'Bank details, PayPal and Wero the payment requests point at.',
    icon: 'i-lucide-hand-coins',

    wizard: {
      steps: [{
        id: 'payee',
        title: 'Payee',
        description: 'Where the money goes',
        icon: 'i-lucide-hand-coins',
        intro: 'The account that receives the payments. Every method you set here — bank transfer, PayPal and Wero — is offered in each request.',
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
            placeholder: 'DE89 3704 0044 0532 0130 00',
            description: 'Optional. Adds a GiroCode and a bank transfer block to every request.'
          },
          {
            name: 'bic',
            label: 'BIC',
            type: 'text',
            placeholder: 'COBADEFFXXX',
            description: 'Optional, and only used together with an IBAN'
          },
          {
            name: 'paypal',
            label: 'PayPal',
            type: 'text',
            component: 'PayeePaypalField',
            placeholder: 'maxmustermann',
            description: 'Scan a PayPal code, or type your paypal.me name'
          },
          {
            name: 'paypalEmails',
            label: 'PayPal account emails',
            type: 'text',
            placeholder: 'max@example.com',
            description: 'PayPal account email address(es), comma-separated — required for automatic confirmation of a PayPal payment mail'
          },
          {
            name: 'wero',
            label: 'Wero',
            type: 'text',
            component: 'PayeeWeroField',
            placeholder: 'd6xY21Hybs',
            description: 'Scan the payment QR from the Wero app'
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
      const iban = normalizeIban(text(values.iban))
      const bic = text(values.bic).toUpperCase()
      const paypal = normalizePaypalHandle(text(values.paypal))
      const paypalEmails = paypalEmailsFrom(values.paypalEmails)
      const wero = text(values.wero)

      return {
        holder: text(values.holder),
        iban: iban || undefined,
        bic: iban ? bic || undefined : undefined,
        paypal: paypal || undefined,
        paypalEmails: paypalEmails.join(', ') || undefined,
        wero: wero || undefined,
        mailService: text(values.mailService)
      }
    },

    validate(values: SetupValues) {
      if (!text(values.holder)) {
        return 'The account holder is required'
      }
      if (!text(values.mailService)) {
        return 'Choose the mail account to send from'
      }

      const iban = text(values.iban)
      const paypal = text(values.paypal)
      const paypalEmails = paypalEmailsFrom(values.paypalEmails)
      const wero = text(values.wero)

      if (!iban && !paypal && !wero) {
        return 'Set at least one payment method: an IBAN, PayPal or Wero'
      }
      if (iban && !isValidIban(iban)) {
        return 'Enter a valid IBAN'
      }
      if (paypal && !isValidPaypalTarget(paypal)) {
        return 'The PayPal name or code is invalid'
      }
      if (paypalEmails.some(email => !isEmailAddress(email))) {
        return 'Enter only email addresses for the PayPal account'
      }
      if (wero && !isValidWeroToken(wero)) {
        return 'The Wero code is invalid'
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
