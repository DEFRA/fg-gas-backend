import Joi from 'joi'
import { ValidationError } from '../errors/validation-error.js'

export class GrantEndpoint {
  static schema = Joi.object({
    name: Joi.string().required(),
    method: Joi.string().valid('GET', 'POST').required(),
    url: Joi.string().required()
  })

  /**
  * @param {Object} props
  * @param {string} props.name
  * @param {string} props.method
  * @param {string} props.url
  */
  constructor (props) {
    Object.assign(this, props)
  }

  static create (props) {
    const { error } = GrantEndpoint.schema.validate(props)

    if (error) {
      throw new ValidationError(`GrantEndpoint ${error.message}`)
    }

    return new GrantEndpoint(props)
  }
}
