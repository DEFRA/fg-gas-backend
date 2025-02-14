import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError } from './http-error.js'

describe('HttpError', () => {
  it('is an instance of Error', () => {
    const error = new HttpError('Request Failed', {
      request: new Request('https://api.example.com/data')
    })

    assert.equal(error instanceof Error, true)
  })

  it('has a name of HttpError', () => {
    const error = new HttpError('Request Failed', {
      request: new Request('https://api.example.com/data')
    })

    assert.equal(error.name, 'HttpError')
  })

  it('has a message with reason', () => {
    const error = new HttpError('Internal Server Error', {
      request: new Request('https://api.example.com/data'),
      response: new Response(null, {
        status: 500,
        statusText: 'Internal Server Error'
      })
    })

    assert.equal(error.message, 'Internal Server Error')
  })

  it('has request and response details', () => {
    const error = new HttpError('Request Failed', {
      request: new Request('https://api.example.com/data', {
        url: 'https://api.example.com/data',
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      }),
      response: new Response(null, {
        status: 500,
        statusText: 'Internal Server Error'
      })
    })

    assert.deepEqual(error.request, {
      url: 'https://api.example.com/data',
      method: 'GET',
      headers: {
        accept: 'application/json'
      }
    })

    assert.deepEqual(error.response, {
      status: 500,
      statusText: 'Internal Server Error'
    })
  })

  it('has a cause', () => {
    const error = new HttpError('Request Failed', {
      request: new Request('https://api.example.com/data'),
      cause: new Error('Network Error')
    })

    assert.equal(error.cause.message, 'Network Error')
  })

  it('has a stack trace', () => {
    const error = new HttpError('Internal Server Error', {
      request: new Request('https://api.example.com/data')
    })

    assert.equal(error.stack.includes('http-error.test.js'), true)
  })
})
