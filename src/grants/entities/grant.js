import ValidationError from '../errors/validation-error.js'
import GrantEndpoint from './grant-endpoint.js'

export default class Grant {
  id
  name
  endpoints = []

  static validate (props) {
    if (!props.name) {
      throw new ValidationError('Grant name is required')
    }

    const validEndpoints = props.endpoints.every(
      r => r instanceof GrantEndpoint
    )

    if (!validEndpoints) {
      throw new ValidationError(
        'Grant endpoints must be instances of GrantEndpoint'
      )
    }
  }

  static create (props) {
    Grant.validate(props)

    const grant = new Grant()

    grant.id = props.id
    grant.name = props.name
    grant.endpoints = props.endpoints

    return grant
  }
}
