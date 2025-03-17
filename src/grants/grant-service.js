import Boom from '@hapi/boom'
import { wreck } from '../common/wreck.js'
import { Grant } from './grant.js'

export const createGrantService = (grantRepository) => {
  return {
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

      const response = await wreck.get(`${endpoint.url}?grantId=${grantId}`, {
        json: true
      })

      return response.payload
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
          `Grant ${grantId} has no POST endpoint named '${name}'`
        )
      }

      const response = await wreck.post(endpoint.url, {
        payload,
        json: true
      })

      return response.payload
    }
  }
}
