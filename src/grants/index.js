/**
 * @type {import('@hapi/hapi').Plugin<any>}
 */
export const grantsPlugin = {
  name: 'grants',
  async register (server, options) {
    const { grantService } = options

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
        return await grantService.invokeGetEndpoint({
          grantId: request.params.grantId,
          name: request.params.name
        })
      }
    })

    server.route({
      method: 'POST',
      path: '/grants/{grantId}/endpoints/{name}/invoke',
      async handler (request, _h) {
        return await grantService.invokePostEndpoint({
          grantId: request.params.grantId,
          name: request.params.name,
          payload: request.payload
        })
      }
    })
  }
}
