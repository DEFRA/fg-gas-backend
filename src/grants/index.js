import { grantService } from './grant-service.js'

/**
 * @type {import('@hapi/hapi').Plugin<any>}
 */
export const grantsPlugin = {
  name: 'grants',
  async register (server) {
    server.route({
      method: 'POST',
      path: '/grants',
      async handler (request, h) {
        const grant = await grantService.create(request.payload)

        return h
          .response({
            grantId: grant.grantId
          })
          .code(201)
      }
    })

    server.route({
      method: 'GET',
      path: '/grants',
      async handler (_request, _h) {
        const grants = await grantService.findAll()

        return grants.map(grant => ({
          grantId: grant.grantId,
          name: grant.name,
          endpoints: grant.endpoints
        }))
      }
    })

    server.route({
      method: 'GET',
      path: '/grants/{grantId}',
      async handler (request, _h) {
        const grant = await grantService.findById(request.params.grantId)

        return {
          grantId: grant.grantId,
          name: grant.name,
          endpoints: grant.endpoints
        }
      }
    })

    server.route({
      method: 'GET',
      path: '/grants/{grantId}/endpoints/{name}/invoke',
      async handler (request, _h) {
        const result = await grantService.invokeGetEndpoint({
          grantId: request.params.grantId,
          name: request.params.name
        })

        return result
      }
    })

    server.route({
      method: 'POST',
      path: '/grants/{grantId}/endpoints/{name}/invoke',
      async handler (request, _h) {
        const result = await grantService.invokePostEndpoint({
          grantId: request.params.grantId,
          name: request.params.name,
          payload: request.payload
        })

        return result
      }
    })
  }
}
