import { protonConnector } from '../proton/connector'
import { createProtonMailProvider } from '../proton/provider'

export default defineNitroPlugin(() => {
  registerConnector(protonConnector)
  registerMailProvider(protonConnector.id, createProtonMailProvider)
})
