import Boom from '@hapi/boom'
import { getTraceId } from '@defra/hapi-tracing'
import { config } from './config.js'

const exec = async (request) => {
  let response

  try {
    response = await fetch(request)
  } catch (error) {
    throw Boom.internal('Request Failed', {
      request,
      error
    })
  }

  if (!response.ok) {
    throw Boom.internal('Request Failed', {
      request,
      response
    })
  }

  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('Content-Type')

  if (!contentType?.includes('application/json')) {
    throw Boom.internal('Invalid Content-Type. Expected application/json', {
      request,
      response
    })
  }

  let json

  try {
    json = await response.json()
  } catch (error) {
    throw Boom.internal('Failed to parse JSON response', {
      request,
      response,
      error
    })
  }

  return json
}

export const httpClient = {
  async get (url) {
    const headers = new Headers({
      Accept: 'application/json'
    })

    const traceId = getTraceId()

    if (traceId) {
      headers.set(config.get('tracing.header'), traceId)
    }

    const request = new Request(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(3000)
    })

    return exec(request)
  },
  async post (url, body) {
    const headers = new Headers({
      Accept: 'application/json',
      'Content-Type': 'application/json'
    })

    const traceId = getTraceId()

    if (traceId) {
      headers.set(config.get('tracing.header'), traceId)
    }

    const request = new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    })

    return exec(request)
  }
}
