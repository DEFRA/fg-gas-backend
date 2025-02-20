import Joi from 'joi'
import { ValidationError } from '../errors/validation-error.js'
import { GrantEndpoint } from './grant-endpoint.js'

export class Grant {
  static schema = Joi.object({
    id: Joi.string().base64().length(24),
    name: Joi.string().required(),
    endpoints: Joi.array().items(GrantEndpoint.schema).required()
  })

  /**
  * @param {Object} props
  * @param {string} props.id
  * @param {string} props.name
  * @param {GrantEndpoint[]} props.endpoints
  */
  constructor (props) {
    Object.assign(this, props)
  }

  static create (props) {
    const { error } = Grant.schema.validate(props)

    if (error) {
      throw new ValidationError(`Grant ${error.message}`)
    }

    return new Grant(props)
  }
}
