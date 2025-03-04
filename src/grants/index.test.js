import { describe, before, it } from 'node:test'
import hapi from '@hapi/hapi'
import { assert } from '../common/assert.js'
import { grantsPlugin } from './index.js'
import { grantService } from './grant-service.js'

describe('grantsPlugin', () => {
  let server

  before(async () => {
    server = hapi.server()
    await server.register(grantsPlugin)
    await server.initialize()
  })

  describe('POST /grants', () => {
    it('creates a new grant and returns the id', async ({ mock }) => {
      mock.method(grantService, 'create', async props => ({
        grantId: '1',
        ...props
      }))

      const { statusCode, result } = await server.inject({
        method: 'POST',
        url: '/grants',
        payload: {
          name: 'test',
          endpoints: []
        }
      })

      assert.calledOnceWith(grantService.create, {
        name: 'test',
        endpoints: []
      })

      assert.equal(statusCode, 201)

      assert.deepEqual(result, {
        grantId: '1'
      })
    })
  })

  describe('GET /grants', () => {
    it('returns all grants', async ({ mock }) => {
      mock.method(grantService, 'findAll', async () => [
        {
          grantId: '1',
          name: 'test 1',
          endpoints: [],
          internal: 'this is private'
        },
        {
          grantId: '2',
          name: 'test 2',
          endpoints: [],
          internal: 'this is private'
        }
      ])

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/grants'
      })

      assert.equal(statusCode, 200)

      assert.deepEqual(result, [
        {
          grantId: '1',
          name: 'test 1',
          endpoints: []
        },
        {
          grantId: '2',
          name: 'test 2',
          endpoints: []
        }
      ])
    })
  })

  describe('GET /grants/{grantId}', () => {
    it('returns matching grant', async ({ mock }) => {
      mock.method(grantService, 'findById', async () => ({
        grantId: '67c1d5d372de5936d94df74c',
        name: 'test 1',
        endpoints: [],
        internal: 'this is private'
      }))

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/grants/67c1d5d372de5936d94df74c'
      })

      assert.equal(statusCode, 200)

      assert.deepEqual(result, {
        grantId: '67c1d5d372de5936d94df74c',
        name: 'test 1',
        endpoints: []
      })
    })
  })

  describe('GET /grants/{grantId}/endpoints/{name}/invoke', () => {
    it('returns response from endpoint', async ({ mock }) => {
      mock.method(grantService, 'invokeGetEndpoint', async () => ({
        arbitrary: 'result'
      }))

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/grants/67c1d5d372de5936d94df74c/endpoints/test/invoke'
      })

      assert.equal(statusCode, 200)

      assert.deepEqual(result, {
        arbitrary: 'result'
      })

      assert.calledOnceWith(grantService.invokeGetEndpoint, {
        grantId: '67c1d5d372de5936d94df74c',
        name: 'test'
      })
    })
  })

  describe('POST /grants/{grantId}/endpoints/{name}/invoke', () => {
    it('returns response from endpoint', async ({ mock }) => {
      mock.method(grantService, 'invokePostEndpoint', async () => ({
        arbitrary: 'result'
      }))

      const { statusCode, result } = await server.inject({
        method: 'POST',
        url: '/grants/67c1d5d372de5936d94df74c/endpoints/test/invoke',
        payload: {
          grantId: '67c1d5d372de5936d94df74c',
          name: 'test'
        }
      })

      assert.equal(statusCode, 200)

      assert.deepEqual(result, {
        arbitrary: 'result'
      })

      assert.calledOnceWith(grantService.invokePostEndpoint, {
        grantId: '67c1d5d372de5936d94df74c',
        name: 'test',
        payload: {
          grantId: '67c1d5d372de5936d94df74c',
          name: 'test'
        }
      })
    })
  })
})
