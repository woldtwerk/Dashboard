import { protonDriveConnector } from '../proton/connector'
import { createProtonDriveProvider } from '../proton/provider'

export default defineNitroPlugin(() => {
  registerConnector(protonDriveConnector)
  registerDriveProvider(protonDriveConnector.id, createProtonDriveProvider)
})
