import ValidationError from '../errors/validation-error.js'

export default class GrantEndpoint {
  name
  method
  url

  static validate (props) {
    if (!props.name) {
      throw new ValidationError('GrantEndpoint name is required')
    }

    if (props.method !== 'GET' && props.method !== 'POST') {
      throw new ValidationError(
        `GrantEndpoint method is invalid. Got ${props.method}`
      )
    }

    if (!props.url) {
      throw new ValidationError('GrantEndpoint url is required')
    }
  }

  static create (props) {
    GrantEndpoint.validate(props)

    const endpoint = new GrantEndpoint()

    endpoint.name = props.name
    endpoint.method = props.method
    endpoint.url = props.url

    return endpoint
  }
}
