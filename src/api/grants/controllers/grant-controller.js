import { DomainError } from '../errors/domain-error.js'
import GrantService from '../services/grant-service.js' // eslint-disable-line no-unused-vars

export default class GrantController {
  #grantService

  routes = [
    {
      method: 'GET',
      path: '/grants/{id}/external/{name}',
      handler: this.getFromExternalEndpoint.bind(this)
    },
    {
      method: 'POST',
      path: '/grants/{id}/external/{name}',
      handler: this.postToExternalEndpoint.bind(this)
    }
  ]

  /**
   * @param {Object} args
   * @param {GrantService} args.grantService
   */
  constructor ({ grantService }) {
    this.#grantService = grantService
  }

  /**
   * @param {Request} request
   * @param {ResponseToolkit} h
   * @returns Promise<ResponseObject>
   */
  async getFromExternalEndpoint (request, h) {
    const { id, name } = request.params

    try {
      const result = await this.#grantService.getFromExternalEndpoint(id, name)

      return h.response(result).code(200)
    } catch (error) {
      request.logger.error(error)

      if (error instanceof DomainError) {
        return h
          .response({
            message: error.message
          })
          .code(400)
      }

      return h.response().code(500)
    }
  }

  /**
   * @param {Request} request
   * @param {ResponseToolkit} h
   * @returns Promise<ResponseObject>
   */
  async postToExternalEndpoint (request, h) {
    const { id, name } = request.params

    try {
      const result = await this.#grantService.postToExternalEndpoint(
        id,
        name,
        request.payload
      )

      return h.response(result).code(200)
    } catch (error) {
      request.logger.error(error)

      if (error instanceof DomainError) {
        return h
          .response({
            message: error.message
          })
          .code(400)
      }

      return h.response().code(500)
    }
  }
}
