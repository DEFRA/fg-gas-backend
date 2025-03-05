import Boom from '@hapi/boom'
import { httpClient } from '../common/http-client.js'
import { grantRepository } from './grant-repository.js'
import { Grant } from './grant.js'

export const grantService = {
  async create (props) {
    const grant = Grant.create(props)

    await grantRepository.add(grant)

    return grant
  },

  async findAll () {
    return grantRepository.findAll()
  },

  async findById (grantId) {
    Grant.validateId(grantId)

    const grant = await grantRepository.findById(grantId)

    if (grant === null) {
      throw Boom.notFound(`Grant ${grantId} not found`)
    }

    return grant
  },

  async invokeGetEndpoint ({ grantId, name }) {
    Grant.validateId(grantId)
    Grant.validateEndpointName(name)

    const grant = await grantRepository.findById(grantId)

    if (grant === null) {
      throw Boom.notFound(`Grant ${grantId} not found`)
    }

    const endpoint = grant.endpoints.find(
      e => e.method === 'GET' && e.name === name
    )

    if (!endpoint) {
      throw Boom.badRequest(
        `Grant ${grantId} has no GET endpoint named '${name}'`
      )
    }

    return httpClient.get(`${endpoint.url}?grantId=${grantId}`)
  },

  async invokePostEndpoint ({ grantId, name, payload }) {
    Grant.validateId(grantId)
    Grant.validateEndpointName(name)
    Grant.validateEndpointPayload(payload)

    const grant = await grantRepository.findById(grantId)

    if (grant === null) {
      throw Boom.notFound(`Grant ${grantId} not found`)
    }

    const endpoint = grant.endpoints.find(
      e => e.method === 'POST' && e.name === name
    )

    if (!endpoint) {
      throw Boom.badRequest(
        `Grant ${grantId} has no GET endpoint named '${name}'`
      )
    }

    return httpClient.post(endpoint.url, {
      metadata: {
        grantId
      },
      payload
    })
  }
}
