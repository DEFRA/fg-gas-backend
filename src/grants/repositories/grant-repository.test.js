import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import GrantRepository from './grant-repository.js'
import Grant from '../entities/grant.js'
import MongoClient from '../../common/mongo-client.js'
import { mock } from '../../common/tests.js'

describe('GrantRepository', () => {
  describe('getById', () => {
    it('returns matching grant', async (t) => {
      const mongoClient = mock(MongoClient)

      t.mock.method(mongoClient, 'db', () => ({
        collection: () => ({
          findOne: async () => ({
            _id: '67aa24b22ccabe791ffa84b9',
            name: 'grant',
            endpoints: [{
              name: 'endpoint',
              method: 'GET',
              url: '/endpoint'
            }]
          })
        })
      }))

      const grantRepository = new GrantRepository({
        config: {
          get: () => 'database'
        },
        mongoClient
      })

      const result = await grantRepository.getById('67aa24b22ccabe791ffa84b9')

      assert.equal(result instanceof Grant, true)
      assert.equal(result.id, '67aa24b22ccabe791ffa84b9')
    })

    it('returns null when grant is not found', async (t) => {
      const mongoClient = mock(MongoClient)

      t.mock.method(mongoClient, 'db', () => ({
        collection: () => ({
          findOne: async () => null
        })
      }))

      const grantRepository = new GrantRepository({
        config: {
          get: () => 'database'
        },
        mongoClient
      })

      const result = await grantRepository.getById('67aa24b22ccabe791ffa84b9')

      assert.equal(result, null)
    })
  })
})
