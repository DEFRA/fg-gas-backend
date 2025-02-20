import Joi from 'joi'
import { Grant } from '../entities/grant.js'
import { GrantEndpoint } from '../entities/grant-endpoint.js'
import { ValidationError } from '../errors/validation-error.js'
import { NotFoundError } from '../errors/not-found-error.js'

/**
 * @import { ServerRoute, Request, ResponseToolkit, ResponseValue } from '@hapi/hapi'
 * @import GrantService from '../services/grant-service.js'
 */

export default class GrantController {
  #grantService

  /**
   * @type {ServerRoute[]}
   * @readonly
   */
  routes = [
    {
      method: 'POST',
      path: '/grants',
      handler: this.create.bind(this)
    },
    {
      method: 'GET',
      path: '/grants',
      handler: this.getAll.bind(this)
    },
    {
      method: 'GET',
      path: '/grants/{id}',
      handler: this.getById.bind(this),
      options: {
        validate: {
          params: Joi.object({
            id: Grant.schema.extract('id').required()
          })
        }
      }
    },
    {
      method: 'GET',
      path: '/grants/{id}/endpoints/{name}/invoke',
      handler: this.invokeEndpoint.bind(this),
      options: {
        validate: {
          params: Joi.object({
            id: Grant.schema.extract('id').required(),
            name: GrantEndpoint.schema.extract('name').required()
          })
        }
      }
    },
    {
      method: 'POST',
      path: '/grants/{id}/endpoints/{name}/invoke',
      handler: this.invokeEndpoint.bind(this),
      options: {
        validate: {
          params: Joi.object({
            id: Grant.schema.extract('id').required(),
            name: GrantEndpoint.schema.extract('name')
          }),
          payload: Joi.object().required()
        }
      }
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
   * Create a new grant
   * @param {Request} request
   * @param {ResponseToolkit} h
   * @returns Promise<ResponseValue>
   */
  async create (request, h) {
    try {
      const grant = await this.#grantService.create(request.payload)

      return h.response({
        id: grant.id
      }).code(201)
    } catch (error) {
      request.logger.error(error)

      if (error instanceof ValidationError) {
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
   * Get all grants
   * @param {Request} _request
   * @param {ResponseToolkit} h
   * @returns Promise<ResponseValue>
   */
  async getAll (_request, h) {
    const grants = await this.#grantService.getAll()

    return h.response(
      grants.map(grant => ({
        id: grant.id,
        name: grant.name,
        endpoints: grant.endpoints
      }))
    ).code(200)
  }

  /**
   * Get a grant by ID
   * @param {Request} request
   * @param {ResponseToolkit} h
   * @returns Promise<ResponseValue>
   */
  async getById (request, h) {
    const grant = await this.#grantService.getById(request.params.id)

    if (grant === null) {
      return h.response().code(404)
    }

    return h.response({
      id: grant.id,
      name: grant.name,
      endpoints: grant.endpoints
    }).code(200)
  }

  /**
   * Invoke an endpoint
   * @param {Request} request
   * @param {ResponseToolkit} h
   * @returns Promise<ResponseValue>
   */
  async invokeEndpoint (request, h) {
    try {
      const result = await this.#grantService.invokeEndpoint(
        request.params.id,
        request.params.name,
        request.method,
        request.payload
      )

      return h.response(result).code(200)
    } catch (error) {
      request.logger.error(error)

      if (error instanceof NotFoundError) {
        return h
          .response({
            message: error.message
          })
          .code(404)
      }

      if (error instanceof ValidationError) {
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
