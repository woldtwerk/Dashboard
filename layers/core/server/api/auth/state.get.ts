import { defineEventHandler } from 'nuxt/server'
import type { AuthState } from '../../../shared/types/auth'
import { countUsers } from '../../db/user-repository'

// Public: the login page asks whether the owner account exists yet
export default defineEventHandler(async (): Promise<AuthState> => ({
  hasUser: await countUsers(await useDb()) > 0
}))
