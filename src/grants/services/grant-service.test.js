import { describe, beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'
import GrantService from './grant-service.js'
import GrantRepository from '../repositories/grant-repository.js'
import Grant from '../entities/grant.js'
import HttpClient from '../../common/http-client.js'
import GrantEndpoint from '../entities/grant-endpoint.js'
import { mock } from '../../common/tests.js'

describe('GrantService', () => {
  describe('getFromExternalEndpoint', () => {
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

    it('calls an external Grant endpoint', async t => {
      t.mock.method(grantRepository, 'getById', async () =>
        Grant.create({
          id: '1',
          name: 'grant1',
          endpoints: [
            GrantEndpoint.create({
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

      const result = await grantService.getFromExternalEndpoint(
        '1',
        'eligibility'
      )

      assert.deepEqual(result, {
        hello: 'world'
      })

      assert.deepEqual(httpClient.get.mock.calls[0].arguments, [
        'https://example.com/data?grantId=1'
      ])
    })

    it('throws DomainError when Grant not found', async t => {
      t.mock.method(grantRepository, 'getById', async () => null)

      await assert.rejects(
        grantService.getFromExternalEndpoint('1', 'eligibility'),
        {
          name: 'DomainError',
          message: 'Grant 1 not found'
        }
      )
    })

    it('throws DomainError when service not found', async t => {
      t.mock.method(grantRepository, 'getById', async id =>
        Grant.create({
          id,
          name: 'grant1',
          endpoints: []
        })
      )

      await assert.rejects(
        grantService.getFromExternalEndpoint('1', 'eligibility'),
        {
          name: 'DomainError',
          message: "Grant 1 has no GET endpoint named 'eligibility'"
        }
      )
    })
  })

  describe('postToExternalEndpoint', () => {
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

    it('posts to an external Grant endpoint', async t => {
      t.mock.method(grantRepository, 'getById', async () =>
        Grant.create({
          id: '1',
          name: 'grant1',
          endpoints: [
            GrantEndpoint.create({
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

      const result = await grantService.postToExternalEndpoint(
        '1',
        'eligibility',
        {
          hello: 'world'
        }
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
          payload: {
            hello: 'world'
          }
        }
      ])
    })

    it('throws DomainError when Grant not found', async t => {
      t.mock.method(grantRepository, 'getById', async () => null)

      await assert.rejects(
        grantService.postToExternalEndpoint('1', 'eligibility', {
          hello: 'world'
        }),
        {
          name: 'DomainError',
          message: 'Grant 1 not found'
        }
      )
    })

    it('throws DomainError when service not found', async t => {
      t.mock.method(grantRepository, 'getById', async id =>
        Grant.create({
          id,
          name: 'grant1',
          endpoints: []
        })
      )

      await assert.rejects(
        grantService.postToExternalEndpoint('1', 'eligibility', {
          hello: 'world'
        }),
        {
          name: 'DomainError',
          message: "Grant 1 has no POST endpoint named 'eligibility'"
        }
      )
    })
  })
})
