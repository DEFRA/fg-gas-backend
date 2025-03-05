import { describe, it } from 'node:test'
import { assert } from '../common/assert.js'
import { db } from '../common/db.js'
import { grantRepository } from './grant-repository.js'
import { ObjectId } from 'mongodb'

describe('grantRepository', () => {
  describe('add', () => {
    it('stores a Grant in the repository', async ({ mock }) => {
      const insertOne = mock.fn(async () => ({
        insertedId: '1'
      }))

      mock.method(db, 'collection', () => ({
        insertOne
      }))

      await grantRepository.add({
        grantId: '1',
        name: 'test',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      })

      assert.calledOnceWith(db.collection, 'grants')
      assert.calledOnceWith(insertOne, {
        _id: '1',
        name: 'test',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      })
    })
  })

  describe('findAll', () => {
    it('returns all Grants from the repository', async ({ mock }) => {
      const toArray = mock.fn(async () => [
        {
          _id: '1',
          name: 'test 1',
          endpoints: [{
            method: 'GET',
            name: 'test',
            url: 'http://localhost'
          }]
        },
        {
          _id: '2',
          name: 'test 2',
          endpoints: [{
            method: 'GET',
            name: 'test',
            url: 'http://localhost'
          }]
        }
      ])

      mock.method(db, 'collection', () => ({
        find: () => ({
          toArray
        })
      }))

      const result = await grantRepository.findAll()

      assert.calledOnceWith(db.collection, 'grants')
      assert.calledOnce(toArray)
      assert.deepEqual(result, [
        {
          grantId: '1',
          name: 'test 1',
          endpoints: [{
            method: 'GET',
            name: 'test',
            url: 'http://localhost'
          }]
        },
        {
          grantId: '2',
          name: 'test 2',
          endpoints: [{
            method: 'GET',
            name: 'test',
            url: 'http://localhost'
          }]
        }
      ])
    })
  })

  describe('findById', () => {
    it('returns a Grant from the repository', async ({ mock }) => {
      const findOne = mock.fn(async () => ({
        _id: '67c8d9cbed26497691136292',
        name: 'test',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      }))

      mock.method(db, 'collection', () => ({
        findOne
      }))

      const result = await grantRepository.findById('67c8d9cbed26497691136292')

      assert.calledOnceWith(db.collection, 'grants')
      assert.calledOnceWith(findOne, {
        _id: new ObjectId('67c8d9cbed26497691136292')
      })
      assert.deepEqual(result, {
        grantId: '67c8d9cbed26497691136292',
        name: 'test',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      })
    })
  })
})
