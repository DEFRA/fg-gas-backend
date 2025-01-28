import { HttpError } from '../grants/errors/http-error.js'

export default class HttpClient {
  async #init (request) {
    let response

    try {
      response = await fetch(request)
    } catch (error) {
      throw new HttpError('Request Failed', {
        request,
        cause: error
      })
    }

    if (!response.ok) {
      throw new HttpError('Request Failed', {
        request,
        response
      })
    }

    if (response.status === 204) {
      return null
    }

    const contentType = response.headers.get('Content-Type')

    if (!contentType?.includes('application/json')) {
      throw new HttpError('Invalid Content-Type. Expected application/json', {
        request,
        response
      })
    }

    let json

    try {
      json = await response.json()
    } catch (error) {
      throw new HttpError('Failed to parse JSON response', {
        request,
        response,
        cause: error
      })
    }

    return json
  }

  /**
   * @param {string} url
   * @param {URLSearchParams} searchParams
   * @return {Promise<Object | null>}
   */
  async get (url) {
    const request = new Request(url, {
      method: 'GET',
      headers: new Headers({
        Accept: 'application/json'
      }),
      signal: AbortSignal.timeout(3000)
    })

    return this.#init(request)
  }

  /**
   * @param {string} url
   * @param {Object} body
   * @return {Promise<*>}
   */
  async post (url, body) {
    const request = new Request(url, {
      method: 'POST',
      headers: new Headers({
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    })

    return this.#init(request)
  }
}
