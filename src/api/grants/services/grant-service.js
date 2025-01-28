import GrantRepository from '../repositories/grant-repository.js' // eslint-disable-line no-unused-vars
import HttpClient from '../../common/http-client.js' // eslint-disable-line no-unused-vars
import { DomainError } from '../errors/domain-error.js'

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
   * @param {string} id
   * @param {string} name
   * @return {Promise<*>}
   */
  async getFromExternalEndpoint (id, name) {
    const grant = await this.#grantRepository.getById(id)

    if (grant === null) {
      throw new DomainError(`Grant ${id} not found`)
    }

    const service = grant.endpoints.find(
      r => r.method === 'GET' && r.name === name
    )

    if (!service) {
      throw new DomainError(`Grant ${id} has no GET endpoint named '${name}'`)
    }

    const url = `${service.url}?${new URLSearchParams({
      grantId: id
    })}`

    return this.#httpClient.get(url)
  }

  /**
   * @param {string} id
   * @param {string} name
   * @param {Object} payload
   * @return {Promise<*>}
   */
  async postToExternalEndpoint (id, name, payload) {
    const grant = await this.#grantRepository.getById(id)

    if (grant === null) {
      throw new DomainError(`Grant ${id} not found`)
    }

    const service = grant.endpoints.find(
      r => r.method === 'POST' && r.name === name
    )

    if (!service) {
      throw new DomainError(`Grant ${id} has no POST endpoint named '${name}'`)
    }

    return this.#httpClient.post(service.url, {
      headers: {
        grantId: id
      },
      payload
    })
  }
}
