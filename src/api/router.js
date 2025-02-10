import { createContainer } from './common/container.js'
import { health } from './health/index.js'

export const router = {
  plugin: {
    name: 'Router',
    register: async server => {
      // Health-check route. Used by platform to check if service is running, do not remove!
      await server.register([health])

      const container = await createContainer()
      server.route(container.resolve('grantController').routes)
    }
  }
}
