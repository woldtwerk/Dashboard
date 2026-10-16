import type { Connector } from '../../../core/server/utils/services'
import { toBridgeValues } from './bridge-account'
import { testProtonConnection, toProtonSettings } from './bridge'
import { useBridgeControl } from './bridge-control'

export const protonConnector: Connector = {
  id: 'proton',
  domain: 'mail',
  title: 'Proton Mail',
  description: 'End-to-end encrypted mail via Proton Mail Bridge.',
  icon: 'i-simple-icons-protonmail',

  wizard: {
    // A stored password is never reused for another server or account
    bindSecretsTo: ['host', 'port', 'user'],
    steps: [{
      id: 'signin',
      title: 'Sign in',
      description: 'Proton account',
      icon: 'i-lucide-log-in',
      intro: 'Proton encrypts your mail end-to-end, so there is no public API. The dashboard reads your mail through Proton Mail Bridge (paid Proton plan required), which runs in its own container, decrypts your mail there and offers it via IMAP. Sign in once, and Bridge keeps the account.',
      component: 'ProtonBridgeLogin',
      // Set by the sign-in; the IMAP password is fetched from Bridge on save
      fields: [
        { name: 'account', label: 'Bridge account', type: 'text', required: true },
        { name: 'user', label: 'IMAP username', type: 'text', required: true },
        { name: 'host', label: 'IMAP host', type: 'text', required: true },
        { name: 'port', label: 'IMAP port', type: 'number', required: true, min: 1, max: 65535 },
        { name: 'password', label: 'IMAP password', type: 'password', secret: true },
        { name: 'tlsCert', label: 'Certificate', type: 'file', required: true }
      ]
    }]
  },

  async complete(values) {
    const bridge = useBridgeControl()
    const account = await bridge.getAccount(String(values.account))

    // Bridge is the source of truth, so the password can only go to its own IMAP server
    return { ...values, ...toBridgeValues(account, bridge.url), password: account.imap.password }
  },

  validate(values) {
    if (!toProtonSettings(values).tlsCert?.includes('-----BEGIN CERTIFICATE-----')) {
      return 'The Bridge certificate is missing. Sign in again.'
    }
  },

  test: values => testProtonConnection(toProtonSettings(values))
}
