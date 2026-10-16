import { defineEventHandler } from 'nuxt/server'
import { useProtonDriveControl } from '../../../proton/control'

// Starts (or resumes) the CLI sign-in and returns the browser URL it prints.
// The CLI keeps running until the user signs in; the client polls the status.
export default defineEventHandler(async () => {
  return useProtonDriveControl().login()
})
