import { NotFoundError } from '../errors/not-found-error.js'
import { ValidationError } from '../errors/validation-error.js'

/**
 * @import GrantRepository from '../repositories/grant-repository.js'
 * @import HttpClient from '../../common/http-client.js'
 * @import Grant from '../entities/grant.js'
 */

export default class GrantService {
  #grantRepository
  #httpClient

  /**
   * @param {Object} args
   * @param {GrantRepository} args.grantRepository
   * @param {HttpClient} args.httpClient
   */
  constructor ({ grantRepository, httpClient }) {
    this.#grantRepository = grantRepository
    this.#httpClient = httpClient
  }

  /**
   * Create a new grant
   * @param {Partial<Grant>} partialGrant
   * @return {Promise<Grant>}
   */
  async create (partialGrant) {
    return this.#grantRepository.create(partialGrant)
  }

  /**
   * Get all grants
   * @return {Promise<Grant[]>}
   */
  async getAll () {
    return this.#grantRepository.getAll()
  }

  /**
   * Get a grant by ID
   * @param {string} id
   * @return {Promise<Grant | null>}
   */
  async getById (id) {
    return this.#grantRepository.getById(id)
  }

  /**
   * Invoke a grant endpoint
   * @param {string} id
   * @param {string} httpMethod
   * @param {string} name
   * @return {Promise<*>}
   * @throws {NotFoundError}
   * @throws {ValidationError}
   */
  async invokeEndpoint (id, name, httpMethod, payload) {
    const method = httpMethod.toUpperCase()

    if (!['GET', 'POST'].includes(method)) {
      throw new ValidationError(`Invalid method ${method}`)
    }

    const grant = await this.#grantRepository.getById(id)

    if (grant === null) {
      throw new NotFoundError(`Grant ${id} not found`)
    }

    const endpoint = grant.endpoints.find(
      e => e.method === method && e.name === name
    )

    if (!endpoint) {
      throw new ValidationError(`Grant ${id} has no GET endpoint named '${name}'`)
    }

    if (method === 'GET') {
      const url = `${endpoint.url}?${new URLSearchParams({
      grantId: id
    })}`

      return this.#httpClient.get(url)
    }

    return this.#httpClient.post(endpoint.url, {
      headers: {
        grantId: id
      },
      payload
    })
  }
}
