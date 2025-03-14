import Boom from '@hapi/boom'
import { wreck } from '../common/wreck.js'
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

  async findByCode (code) {
    Grant.validateCode(code)

    const grant = await grantRepository.findByCode(code)

    if (grant === null) {
      throw Boom.notFound(`Grant with code "${code}" not found`)
    }

    return grant
  },

  async invokeGetEndpoint ({ code, name }) {
    Grant.validateCode(code)
    Grant.validateEndpointName(name)

    const grant = await grantRepository.findByCode(code)

    if (grant === null) {
      throw Boom.notFound(`Grant with code "${code}" not found`)
    }

    const endpoint = grant.endpoints.find(
      e => e.method === 'GET' && e.name === name
    )

    if (!endpoint) {
      throw Boom.badRequest(
        `Grant with code "${code}" has no GET endpoint named "${name}"`
      )
    }

    const response = await wreck.get(`${endpoint.url}?code=${code}`, {
      json: true
    })

    return response.payload
  },

  async invokePostEndpoint ({ code, name, payload }) {
    Grant.validateCode(code)
    Grant.validateEndpointName(name)
    Grant.validateEndpointPayload(payload)

    const grant = await grantRepository.findByCode(code)

    if (grant === null) {
      throw Boom.notFound(`Grant with code "${code}" not found`)
    }

    const endpoint = grant.endpoints.find(
      e => e.method === 'POST' && e.name === name
    )

    if (!endpoint) {
      throw Boom.badRequest(
        `Grant with code "${code}" has no POST endpoint named "${name}"`
      )
    }

    const response = await wreck.post(endpoint.url, {
      payload,
      json: true
    })

    return response.payload
  }
}
