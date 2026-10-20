import { createPayeeConnector } from '../payee/connector'

export default defineNitroPlugin(() => {
  registerConnector(createPayeeConnector())
})
