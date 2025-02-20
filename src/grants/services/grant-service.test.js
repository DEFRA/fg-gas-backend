import { describe, beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'
import GrantService from './grant-service.js'
import GrantRepository from '../repositories/grant-repository.js'
import { Grant } from '../entities/grant.js'
import HttpClient from '../../common/http-client.js'
import { GrantEndpoint } from '../entities/grant-endpoint.js'
import { mock } from '../../common/tests.js'

describe('GrantService', () => {
  describe('create', () => {
    let grantRepository
    let httpClient
    let grantService

    beforeEach(() => {
      httpClient = mock(HttpClient)
      grantRepository = mock(GrantRepository)
      grantService = new GrantService({
        grantRepository,
        httpClient
      })
    })

    it('creates a new grant', async t => {
      t.mock.method(grantRepository, 'create', async () =>
        new Grant({
          id: '1',
          name: 'grant1'
        })
      )

      const result = await grantService.create({ name: 'grant1' })

      assert.deepEqual(result, new Grant({
        id: '1',
        name: 'grant1'
      }))
    })
  })

  describe('getAll', () => {
    let grantRepository
    let httpClient
    let grantService

    beforeEach(() => {
      httpClient = mock(HttpClient)
      grantRepository = mock(GrantRepository)
      grantService = new GrantService({
        grantRepository,
        httpClient
      })
    })

    it('returns all grants', async t => {
      t.mock.method(grantRepository, 'getAll', async () => [
        new Grant({
          id: '1',
          name: 'grant1'
        }),
        new Grant({
          id: '2',
          name: 'grant2'
        })
      ])

      const result = await grantService.getAll()

      assert.deepEqual(result, [
        new Grant({
          id: '1',
          name: 'grant1'
        }),
        new Grant({
          id: '2',
          name: 'grant2'
        })
      ])
    })
  })

  describe('getById', () => {
    let grantRepository
    let httpClient
    let grantService

    beforeEach(() => {
      httpClient = mock(HttpClient)
      grantRepository = mock(GrantRepository)
      grantService = new GrantService({
        grantRepository,
        httpClient
      })
    })

    it('returns matching grant', async t => {
      t.mock.method(grantRepository, 'getById', async () =>
        new Grant({
          id: '1',
          name: 'grant1'
        })
      )

      const result = await grantService.getById('1')

      assert.deepEqual(result, new Grant({
        id: '1',
        name: 'grant1'
      }))
    })

    it('returns null when grant is not found', async t => {
      t.mock.method(grantRepository, 'getById', async () => null)

      const result = await grantService.getById('1')

      assert.equal(result, null)
    })
  })

  describe('invokeEndpoint', () => {
    let grantRepository
    let httpClient
    let grantService

    beforeEach(() => {
      httpClient = mock(HttpClient)
      grantRepository = mock(GrantRepository)
      grantService = new GrantService({
        grantRepository,
        httpClient
      })
    })

    it('calls an external GET endpoint', async t => {
      t.mock.method(grantRepository, 'getById', async () =>
        new Grant({
          id: '1MTIzNDU2NzgxMjM0NTY3ODEyMzQ1Njc4',
          name: 'grant1',
          endpoints: [
            new GrantEndpoint({
              name: 'eligibility',
              method: 'GET',
              url: 'https://example.com/data'
            })
          ]
        })
      )

      t.mock.method(httpClient, 'get', async () => ({
        hello: 'world'
      }))

      const result = await grantService.invokeEndpoint(
        '1',
        'eligibility',
        'get'
      )

      assert.deepEqual(result, {
        hello: 'world'
      })

      assert.deepEqual(httpClient.get.mock.calls[0].arguments, [
        'https://example.com/data?grantId=1'
      ])
    })

    it('calls an external POST endpoint', async t => {
      t.mock.method(grantRepository, 'getById', async () =>
        new Grant({
          id: '1MTIzNDU2NzgxMjM0NTY3ODEyMzQ1Njc4',
          name: 'grant1',
          endpoints: [
            new GrantEndpoint({
              name: 'eligibility',
              method: 'POST',
              url: 'https://example.com/data'
            })
          ]
        })
      )

      t.mock.method(httpClient, 'post', async () => ({
        hello: 'world'
      }))

      const result = await grantService.invokeEndpoint(
        '1',
        'eligibility',
        'post',
        { data: 'test' }
      )

      assert.deepEqual(result, {
        hello: 'world'
      })

      assert.deepEqual(httpClient.post.mock.calls[0].arguments, [
        'https://example.com/data',
        {
          headers: {
            grantId: '1'
          },
          payload: { data: 'test' }
        }
      ])
    })

    it('throws ValidationError when method is invalid', async t => {
      await assert.rejects(
        grantService.invokeEndpoint('1', 'eligibility', 'PUT'),
        {
          name: 'ValidationError',
          message: 'Invalid method PUT'
        }
      )
    })

    it('throws NotFoundError when Grant not found', async t => {
      t.mock.method(grantRepository, 'getById', async () => null)

      await assert.rejects(
        grantService.invokeEndpoint('1', 'eligibility', 'get'),
        {
          name: 'NotFoundError',
          message: 'Grant 1 not found'
        }
      )
    })

    it('throws ValidationError when service not found', async t => {
      t.mock.method(grantRepository, 'getById', async id =>
        new Grant({
          id,
          name: 'grant1',
          endpoints: []
        })
      )

      await assert.rejects(
        grantService.invokeEndpoint('1', 'eligibility', 'get'),
        {
          name: 'ValidationError',
          message: "Grant 1 has no GET endpoint named 'eligibility'"
        }
      )
    })
  })
})
