import type { Connector } from '../../../core/server/utils/services'
import { testProtonDriveConnection } from './provider'

/** Proton Drive via the official Proton Drive CLI, run in its own container. */
export const protonDriveConnector: Connector = {
  id: 'proton-drive',
  domain: 'drive',
  title: 'Proton Drive',
  description: 'End-to-end encrypted files via the official Proton Drive CLI.',
  icon: 'i-simple-icons-protondrive',

  wizard: {
    bindSecretsTo: ['account'],
    steps: [{
      id: 'signin',
      title: 'Sign in',
      description: 'Proton account',
      icon: 'i-lucide-log-in',
      intro: 'Proton has no public filesystem API. The dashboard reads and manages your files through the official Proton Drive CLI, which runs in its own container, decrypts there and keeps the session. Sign in on another device with the link shown below; the account stays signed in.',
      component: 'ProtonDriveLogin',
      // Filled by the sign-in; the CLI container is the source of truth for the account
      fields: [
        { name: 'account', label: 'Proton account', type: 'text', required: true }
      ]
    }]
  },

  test: (_values, context) => runLoggedTest('drive', context?.serviceId, 'Proton Drive connection test failed', () => testProtonDriveConnection())
}
