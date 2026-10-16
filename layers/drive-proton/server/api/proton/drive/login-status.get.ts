import { defineEventHandler } from 'nuxt/server'
import { useProtonDriveControl } from '../../../proton/control'

export default defineEventHandler(async () => {
  return useProtonDriveControl().loginStatus()
})
