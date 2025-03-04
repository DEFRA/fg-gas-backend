import { describe, it, before, after } from 'node:test'
import { Agent, MockAgent, setGlobalDispatcher } from 'undici'
import { assert } from '../common/assert.js'
import { httpClient } from './http-client.js'

describe('httpClient', () => {
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

      const response = await httpClient.get('https://example.com/data')

      assert.deepEqual(response, null)
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws when request cannot be made', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'GET'
        })
        .replyWithError(new Error('fetch failed'))

      await assert.rejects(
        () => httpClient.get('https://example.com/data'),
        new Error('Request Failed')
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws when response is not 2xx', async () => {
      mockAgent
        .get('https://example.com')
        .intercept({
          path: '/data',
          method: 'GET'
        })
        .reply(404, 'Not Found')

      await assert.rejects(
        () => httpClient.get('https://example.com/data'),
        new Error('Request Failed')
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws when response Content-Type is not application/json', async () => {
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

      await assert.rejects(
        () => httpClient.get('https://example.com/data'),
        new Error('Invalid Content-Type. Expected application/json')
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws when response is application/json however the body is not JSON', async () => {
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

      await assert.rejects(
        () => httpClient.get('https://example.com/data'),
        new Error('Failed to parse JSON response')
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

      const response = await httpClient.post('https://example.com/data', {
        hello: 'world'
      })

      assert.deepEqual(response, null)
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws when request cannot be made', async () => {
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

      await assert.rejects(() =>
        httpClient.post('https://example.com/data', {
          hello: 'world'
        })
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws when response is not 2xx', async () => {
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

      await assert.rejects(
        () =>
          httpClient.post('https://example.com/data', {
            hello: 'world'
          }),
        new Error('Request Failed')
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws when response Content-Type is not application/json', async () => {
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

      await assert.rejects(
        () =>
          httpClient.post('https://example.com/data', {
            hello: 'world'
          }),
        new Error('Invalid Content-Type. Expected application/json')
      )
      mockAgent.assertNoPendingInterceptors()
    })

    it('throws when response is application/json however the body is not JSON', async () => {
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

      await assert.rejects(
        () =>
          httpClient.post('https://example.com/data', {
            hello: 'world'
          }),
        new Error('Failed to parse JSON response')
      )
      mockAgent.assertNoPendingInterceptors()
    })
  })
})
