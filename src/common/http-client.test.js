import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Agent, MockAgent, setGlobalDispatcher } from 'undici'
import HttpClient from './http-client.js'
import { HttpError } from '../grants/errors/http-error.js'

describe('HttpClient', () => {
  const mockAgent = new MockAgent()

  before(() => {
    setGlobalDispatcher(mockAgent)
    mockAgent.disableNetConnect()
  })

  after(async () => {
    await mockAgent.close()
    setGlobalDispatcher(new Agent())
  })

  describe('get', () => {
    it('can make a GET request', async () => {
      const data = {
        hello: 'world'
      }

      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        })
        .reply(200, data, {
          headers: {
            'Content-Type': 'application/json'
          }
        })

      const httpClient = new HttpClient()

      const response = await httpClient.get('https://example.com/data')

      assert.deepEqual(response, data)
      mockAgent.assertNoPendingInterceptors()
    })

    it('returns null when response is 204 No Content', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        })
        .reply(204)

      const httpClient = new HttpClient()

      const response = await httpClient.get('https://example.com/data')

      assert.deepEqual(response, null)
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws HttpError when request cannot be made', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'GET'
        })
        .replyWithError(new Error('fetch failed'))

      const httpClient = new HttpClient()

      await assert.rejects(
        () => httpClient.get('https://example.com/data'),
        err => {
          assert.equal(err instanceof HttpError, true)
          assert.equal(err.message, 'Request Failed')
          assert.equal(err.cause.message, 'fetch failed')
          return true
        }
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws HttpError when response is not 2xx', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'GET'
        })
        .reply(404, 'Not Found')

      const httpClient = new HttpClient()

      const httpError = new HttpError('Request Failed', {
        request: new Request('https://example.com/data', {
          url: 'https://example.com/data',
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        }),
        response: new Response('Not Found', {
          status: 404,
          statusText: 'Not Found'
        })
      })

      await assert.rejects(
        () => httpClient.get('https://example.com/data'),
        httpError
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws HttpError when response Content-Type is not application/json', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'GET'
        })
        .reply(200, 'not json', {
          headers: {
            'Content-Type': 'text/html'
          }
        })

      const httpClient = new HttpClient()

      const httpError = new HttpError(
        'Invalid Content-Type. Expected application/json',
        {
          request: new Request('https://example.com/data', {
            url: 'https://example.com/data',
            method: 'GET',
            headers: {
              Accept: 'application/json'
            }
          }),
          response: new Response('not json', {
            status: 200,
            statusText: 'OK'
          })
        }
      )

      await assert.rejects(
        () => httpClient.get('https://example.com/data'),
        httpError
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws HttpError when response is application/json however the body is not JSON', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        })
        .reply(200, 'not json', {
          headers: {
            'Content-Type': 'application/json'
          }
        })

      const httpClient = new HttpClient()

      const httpError = new HttpError('Failed to parse JSON response', {
        request: new Request('https://example.com/data', {
          url: 'https://example.com/data',
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        }),
        response: new Response('not json', {
          status: 200,
          statusText: 'OK'
        }),
        cause: new SyntaxError(
          'Unexpected token \'o\', "not json" is not valid JSON'
        )
      })

      await assert.rejects(
        () => httpClient.get('https://example.com/data'),
        httpError
      )
      mockAgent.assertNoPendingInterceptors()
    })
  })

  describe('post', () => {
    it('can make a POST request', async () => {
      const data = {
        hello: 'hi'
      }

      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        })
        .reply(200, data, {
          headers: {
            'Content-Type': 'application/json'
          }
        })

      const httpClient = new HttpClient()

      const response = await httpClient.post('https://example.com/data', {
        hello: 'world'
      })

      assert.deepEqual(response, data)
      mockAgent.assertNoPendingInterceptors()
    })

    it('returns null when response is 204 No Content', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        })
        .reply(204)

      const httpClient = new HttpClient()

      const response = await httpClient.post('https://example.com/data', {
        hello: 'world'
      })

      assert.deepEqual(response, null)
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws HttpError when request cannot be made', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        })
        .replyWithError(new Error('fetch failed'))

      const httpClient = new HttpClient()

      await assert.rejects(
        () =>
          httpClient.post('https://example.com/data', {
            hello: 'world'
          }),
        err => {
          assert.equal(err instanceof HttpError, true)
          assert.equal(err.message, 'Request Failed')
          assert.equal(err.cause.message, 'fetch failed')
          return true
        }
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws HttpError when response is not 2xx', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        })
        .reply(404, 'Not Found')

      const httpClient = new HttpClient()

      const httpError = new HttpError('Request Failed', {
        request: new Request('https://example.com/data', {
          url: 'https://example.com/data',
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        }),
        response: new Response('Not Found', {
          status: 404,
          statusText: 'Not Found'
        })
      })

      await assert.rejects(
        () =>
          httpClient.post('https://example.com/data', {
            hello: 'world'
          }),
        httpError
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws HttpError when response Content-Type is not application/json', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        })
        .reply(200, 'not json', {
          headers: {
            'Content-Type': 'text/html'
          }
        })

      const httpClient = new HttpClient()

      const httpError = new HttpError(
        'Invalid Content-Type. Expected application/json',
        {
          request: new Request('https://example.com/data', {
            url: 'https://example.com/data',
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json'
            }
          }),
          response: new Response('not json', {
            status: 200,
            statusText: 'OK'
          })
        }
      )

      await assert.rejects(
        () =>
          httpClient.post('https://example.com/data', {
            hello: 'world'
          }),
        httpError
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws HttpError when response is application/json however the body is not JSON', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        })
        .reply(200, 'not json', {
          headers: {
            'Content-Type': 'application/json'
          }
        })

      const httpClient = new HttpClient()

      const httpError = new HttpError('Failed to parse JSON response', {
        request: new Request('https://example.com/data', {
          url: 'https://example.com/data',
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        }),
        response: new Response('not json', {
          status: 200,
          statusText: 'OK'
        }),
        cause: new SyntaxError(
          'Unexpected token \'o\', "not json" is not valid JSON'
        )
      })

      await assert.rejects(
        () =>
          httpClient.post('https://example.com/data', {
            hello: 'world'
          }),
        httpError
      )
      mockAgent.assertNoPendingInterceptors()
    })
  })
})
