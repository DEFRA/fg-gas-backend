import { describe, it, mock } from 'node:test'
import { assert } from '../common/assert.js'
import { wreck } from '../common/wreck.js'
import { Grant } from './grant.js'
import { createGrantService } from './grant-service.js'

describe('grantService', () => {
  const grantRepositoryMock = {
    add: mock.fn(),
    findAll: mock.fn(),
    findById: mock.fn()
  }
  const grantService = createGrantService(grantRepositoryMock)

  describe('create', () => {
    it('stores the grant in the repository', async ({ mock }) => {
      const grant = {
        id: '1',
        name: 'test',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      }
      mock.method(Grant, 'create', () => grant)
      grantRepositoryMock.add.mock.mockImplementationOnce(async () => {})
      const result = await grantService.create({
        name: 'test',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      })
      assert.calledOnceWith(grantRepositoryMock.add, grant)
      assert.deepStrictEqual(result, grant)
    })
  })

  describe('findAll', () => {
    it('returns all grants from the repository', async () => {
      const grants = [
        {
          id: '1',
          name: 'test 1',
          endpoints: []
        },
        {
          id: '2',
          name: 'test 2',
          endpoints: []
        }
      ]
      grantRepositoryMock.findAll.mock.mockImplementationOnce(async () => grants)
      const result = await grantService.findAll()
      assert.deepStrictEqual(result, grants)
    })
  })

  describe('findById', () => {
    it('returns the grant from the repository', async ({ mock }) => {
      const grant = {
        id: '1',
        name: 'test 1',
        endpoints: []
      }
      mock.method(Grant, 'validateId', () => '1')
      grantRepositoryMock.findById.mock.mockImplementationOnce(async () => grant)
      const result = await grantService.findById('1')
      assert.deepStrictEqual(result, grant)
    })

    it('throws when the grant is not found', async ({ mock }) => {
      mock.method(Grant, 'validateId', () => '1')
      grantRepositoryMock.findById.mock.mockImplementationOnce(async () => null)
      await assert.rejects(grantService.findById('1'), {
        message: 'Grant 1 not found'
      })
    })
  })

  describe('invokeGetEndpoint', () => {
    it('invokes the GET endpoint', async ({ mock }) => {
      const grant = {
        id: '1',
        name: 'test',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      }
      mock.method(Grant, 'validateId', () => '1')
      mock.method(Grant, 'validateEndpointName', () => 'test')
      grantRepositoryMock.findById.mock.mockImplementationOnce(async () => grant)
      const response = {
        arbitrary: 'response'
      }
      mock.method(wreck, 'get', async () => ({
        payload: response
      }))
      const result = await grantService.invokeGetEndpoint({
        grantId: '1',
        name: 'test'
      })
      assert.calledOnceWith(wreck.get, 'http://localhost?grantId=1', {
        json: true
      })
      assert.deepStrictEqual(result, response)
    })

    it('throws when the grant is not found', async ({ mock }) => {
      mock.method(Grant, 'validateId', () => '1')
      mock.method(Grant, 'validateEndpointName', () => 'test')
      mock.method(wreck, 'get', async () => {})
      grantRepositoryMock.findById.mock.mockImplementationOnce(async () => null)
      await assert.rejects(grantService.invokeGetEndpoint({
        grantId: '1',
        name: 'test'
      }), {
        message: 'Grant 1 not found'
      })
      assert.notCalled(wreck.get)
    })

    it('throws when the endpoint is not found', async ({ mock }) => {
      const grant = {
        id: '1',
        name: 'Test',
        endpoints: []
      }
      mock.method(Grant, 'validateId', () => '1')
      mock.method(Grant, 'validateEndpointName', () => 'test')
      mock.method(wreck, 'get', async () => {})
      grantRepositoryMock.findById.mock.mockImplementationOnce(async () => grant)
      await assert.rejects(grantService.invokeGetEndpoint({
        grantId: '1',
        name: 'test'
      }), {
        message: 'Grant 1 has no GET endpoint named \'test\''
      })
      assert.notCalled(wreck.get)
    })
  })

  describe('invokePostEndpoint', () => {
    it('invokes the POST endpoint', async ({ mock }) => {
      const grant = {
        id: '1',
        name: 'test',
        endpoints: [{
          method: 'POST',
          name: 'test',
          url: 'http://localhost'
        }]
      }
      mock.method(Grant, 'validateId', () => '1')
      mock.method(Grant, 'validateEndpointName', () => 'test')
      mock.method(Grant, 'validateEndpointPayload', () => ({ grantId: '1', name: 'test' }))
      grantRepositoryMock.findById.mock.mockImplementationOnce(async () => grant)
      const response = {
        arbitrary: 'response'
      }
      mock.method(wreck, 'post', async () => ({
        payload: response
      }))
      const result = await grantService.invokePostEndpoint({
        grantId: '1',
        name: 'test',
        payload: {
          grantId: '1',
          name: 'test'
        }
      })
      assert.calledOnceWith(wreck.post, 'http://localhost', {
        payload: {
          grantId: '1',
          name: 'test'
        },
        json: true
      })
      assert.deepStrictEqual(result, response)
    })

    it('throws when the grant is not found', async ({ mock }) => {
      mock.method(Grant, 'validateId', () => '1')
      mock.method(Grant, 'validateEndpointName', () => 'test')
      mock.method(Grant, 'validateEndpointPayload', () => ({ grantId: '1', name: 'test' }))
      mock.method(wreck, 'post', async () => {})
      grantRepositoryMock.findById.mock.mockImplementationOnce(async () => null)
      await assert.rejects(grantService.invokePostEndpoint({
        grantId: '1',
        name: 'test',
        payload: {
          grantId: '1',
          name: 'test'
        }
      }), {
        message: 'Grant 1 not found'
      })
      assert.notCalled(wreck.post)
    })

    it('throws when the endpoint is not found', async ({ mock }) => {
      const grant = {
        id: '1',
        name: 'Test',
        endpoints: []
      }
      mock.method(Grant, 'validateId', () => '1')
      mock.method(Grant, 'validateEndpointName', () => 'test')
      mock.method(Grant, 'validateEndpointPayload', () => ({ grantId: '1', name: 'test' }))
      mock.method(wreck, 'post', async () => {})
      grantRepositoryMock.findById.mock.mockImplementationOnce(async () => grant)
      await assert.rejects(grantService.invokePostEndpoint({
        grantId: '1',
        name: 'test',
        payload: {
          grantId: '1',
          name: 'test'
        }
      }), {
        message: 'Grant 1 has no POST endpoint named \'test\''
      })
      assert.notCalled(wreck.post)
    })

    it('throws when the payload is invalid', async ({ mock }) => {
      const grant = {
        id: '1',
        name: 'Test',
        endpoints: [{
          method: 'POST',
          name: 'test',
          url: 'http://localhost'
        }]
      }

      mock.method(Grant, 'validateId', () => '1')
      mock.method(Grant, 'validateEndpointName', () => 'test')
      mock.method(Grant, 'validateEndpointPayload', () => {
        throw new Error('Invalid request payload input')
      })
      mock.method(wreck, 'post', async () => {})
      grantRepositoryMock.findById.mock.mockImplementationOnce(async () => grant)
      await assert.rejects(grantService.invokePostEndpoint({
        grantId: '1',
        name: 'test',
        payload: {
          grantId: '1'
        }
      }), {
        message: 'Invalid request payload input'
      })
      assert.notCalled(wreck.post)
    })
  })
})
