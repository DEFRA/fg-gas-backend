import Boom from '@hapi/boom'
import Joi from 'joi'
import { ObjectId } from 'mongodb'

const endpointNameSchema = Joi.object({
  name: Joi.string().pattern(/^[a-z0-9-]+$/).min(1).max(30).required()
})

const endpointMethodSchema = Joi.object({
  method: Joi.string().valid('GET', 'POST').required()
})

const endpointUrlSchema = Joi.object({
  url: Joi.string().uri().max(3000).required()
})

const grantEndpointPayload = Joi.object({}).unknown(true).required()

const endpointSchema = Joi.object({
  endpoints: Joi.array()
    .items(
      Joi
        .object()
        .concat(endpointNameSchema)
        .concat(endpointMethodSchema)
        .concat(endpointUrlSchema)
    )
    .max(20)
    .required()
})

const idSchema = Joi.object({
  grantId: Joi.string().hex().length(24)
})

const createGrantSchema = Joi.object({
  name: Joi.string().min(1).max(100).required()
}).concat(endpointSchema)

export const Grant = {
  create (props) {
    const { error } = createGrantSchema.validate(props)

    if (error) {
      throw Boom.badRequest(error)
    }

    return {
      grantId: new ObjectId().toString(),
      name: props.name,
      endpoints: props.endpoints.map(e => ({
        name: e.name,
        method: e.method,
        url: e.url
      }))
    }
  },

  validateId (grantId) {
    const { error } = idSchema.validate({ grantId })

    if (error) {
      throw Boom.badRequest(error)
    }
  },

  validateEndpointName (name) {
    const { error } = endpointNameSchema.validate({ name })

    if (error) {
      throw Boom.badRequest(error)
    }
  },

  validateEndpointPayload (payload) {
    const { error } = grantEndpointPayload.validate(payload)

    if (error) {
      throw Boom.badRequest(error)
    }
  }
}
