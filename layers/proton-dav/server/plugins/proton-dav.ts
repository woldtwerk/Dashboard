import { caldavConnector, carddavConnector, carbonateCalendarConnector, carbonateContactsConnector } from '../connectors/connector'

export default defineNitroPlugin(() => {
  registerConnector(carbonateCalendarConnector)
  registerConnector(carbonateContactsConnector)
  registerConnector(caldavConnector)
  registerConnector(carddavConnector)
})
