import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { mailAccountAddress, mailOwnAddresses } from '../../utils/mail-identity'

/** The addresses the account may send from, the setup address first and as `default` */
export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, serviceQuerySchema)

  const [own, setup] = await Promise.all([
    mailOwnAddresses(service),
    mailAccountAddress(service)
  ])

  const addresses = [...new Set([setup, ...own].filter((address): address is string => !!address))]

  return { addresses, default: setup }
})
