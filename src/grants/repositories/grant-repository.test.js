import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import GrantRepository from './grant-repository.js'
import { Grant } from '../entities/grant.js'
import MongoClient from '../../common/mongo-client.js'
import { mock } from '../../common/tests.js'
import { GrantEndpoint } from '../entities/grant-endpoint.js'

describe('GrantRepository', () => {
  describe('create', () => {
    it('creates a new grant', async (t) => {
      const mongoClient = mock(MongoClient)

      t.mock.method(mongoClient, 'db', () => ({
        collection: () => ({
          insertOne: async () => ({
            insertedId: '67aa24b22ccabe791ffa84b9'
          })
        })
      }))

      const grantRepository = new GrantRepository({
        config: {
          get: () => 'database'
        },
        mongoClient
      })

      const result = await grantRepository.create({
        name: 'grant',
        endpoints: [{
          name: 'endpoint',
          method: 'GET',
          url: '/endpoint'
        }]
      })

      assert.ok(result instanceof Grant)
      assert.equal(result.id, '67aa24b22ccabe791ffa84b9')
      assert.equal(result.name, 'grant')
      assert.deepEqual(result.endpoints, [
        new GrantEndpoint({
          name: 'endpoint',
          method: 'GET',
          url: '/endpoint'
        })
      ])
    })
  })

  describe('getAll', () => {
    it('returns all grants', async (t) => {
      const mongoClient = mock(MongoClient)

      t.mock.method(mongoClient, 'db', () => ({
        collection: () => ({
          find: () => ({
            toArray: async () => [{
              _id: '67aa24b22ccabe791ffa84b9',
              name: 'grant',
              endpoints: [{
                name: 'endpoint',
                method: 'GET',
                url: '/endpoint'
              }]
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

      const result = await grantRepository.getAll()

      assert.equal(result.length, 1)
      assert.ok(result[0] instanceof Grant)
      assert.equal(result[0].id, '67aa24b22ccabe791ffa84b9')
      assert.equal(result[0].name, 'grant')
      assert.deepEqual(result[0].endpoints, [
        new GrantEndpoint({
          name: 'endpoint',
          method: 'GET',
          url: '/endpoint'
        })
      ])
    })
  })

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
