import { describe, before, it, mock } from 'node:test'
import hapi from '@hapi/hapi'
import { assert } from '../common/assert.js'
import { grantsPlugin } from './index.js'

describe('grantsPlugin routes', () => {
  let server

  const grantServiceMock = {
    create: mock.fn(),
    findAll: mock.fn(),
    findById: mock.fn(),
    invokeGetEndpoint: mock.fn(),
    invokePostEndpoint: mock.fn()
  }

  before(async () => {
    server = hapi.server()
    await server.register([
      {
        plugin: grantsPlugin,
        options: {
          grantService: grantServiceMock
        }
      }
    ])
    await server.initialize()
  })

  describe('POST /grants', () => {
    it('creates a new grant and returns the id', async () => {
      grantServiceMock.create.mock.mockImplementationOnce(async props => ({
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
      assert.calledOnceWith(grantServiceMock.create, {
        name: 'test',
        endpoints: []
      })
      assert.strictEqual(statusCode, 201)
      assert.deepStrictEqual(result, {
        grantId: '1'
      })
    })
  })

  describe('GET /grants', () => {
    it('returns all grants', async () => {
      grantServiceMock.findAll.mock.mockImplementationOnce(async () => ([
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
      ]))
      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/grants'
      })
      assert.strictEqual(statusCode, 200)
      assert.deepStrictEqual(result, [
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
    it('returns matching grant', async () => {
      grantServiceMock.findById.mock.mockImplementationOnce(async () => ({
        grantId: '67c1d5d372de5936d94df74c',
        name: 'test 1',
        endpoints: [],
        internal: 'this is private'
      }))
      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/grants/67c1d5d372de5936d94df74c'
      })
      assert.strictEqual(statusCode, 200)
      assert.deepStrictEqual(result, {
        grantId: '67c1d5d372de5936d94df74c',
        name: 'test 1',
        endpoints: []
      })
    })
  })

  describe('GET /grants/{grantId}/endpoints/{name}/invoke', () => {
    it('returns response from endpoint', async () => {
      grantServiceMock.invokeGetEndpoint.mock.mockImplementationOnce(async () => ({
        arbitrary: 'result'
      }))
      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/grants/67c1d5d372de5936d94df74c/endpoints/test/invoke'
      })
      assert.strictEqual(statusCode, 200)
      assert.deepStrictEqual(result, {
        arbitrary: 'result'
      })
      assert.calledOnceWith(grantServiceMock.invokeGetEndpoint, {
        grantId: '67c1d5d372de5936d94df74c',
        name: 'test'
      })
    })
  })

  describe('POST /grants/{grantId}/endpoints/{name}/invoke', () => {
    it('returns response from endpoint', async () => {
      grantServiceMock.invokePostEndpoint.mock.mockImplementationOnce(async () => ({
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
      assert.strictEqual(statusCode, 200)
      assert.deepStrictEqual(result, {
        arbitrary: 'result'
      })
      assert.calledOnceWith(grantServiceMock.invokePostEndpoint, {
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
