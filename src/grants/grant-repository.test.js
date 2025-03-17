import { describe, it, mock, beforeEach } from 'node:test'
import { assert } from '../common/assert.js'
import { createGrantRepository } from './grant-repository.js'
import { ObjectId } from 'mongodb'

describe('grantRepository', () => {
  const dbMock = {
    collection: mock.fn()
  }
  const grantRepository = createGrantRepository(dbMock)

  describe('add', () => {
    beforeEach(() => {
      dbMock.collection.mock.resetCalls()
    })

    it('stores a Grant in the repository', async ({ mock }) => {
      const insertOne = mock.fn(async () => ({
        insertedId: '1'
      }))

      dbMock.collection.mock.mockImplementationOnce(() => ({
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

      assert.calledOnceWith(dbMock.collection, 'grants')
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
    beforeEach(() => {
      dbMock.collection.mock.resetCalls()
    })

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

      dbMock.collection.mock.mockImplementationOnce(() => ({
        find: () => ({
          toArray
        })
      }))

      const result = await grantRepository.findAll()

      assert.calledOnceWith(dbMock.collection, 'grants')
      assert.calledOnce(toArray)
      assert.deepStrictEqual(result, [
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
    beforeEach(() => {
      dbMock.collection.mock.resetCalls()
    })

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

      dbMock.collection.mock.mockImplementationOnce(() => ({
        findOne
      }))

      const result = await grantRepository.findById('67c8d9cbed26497691136292')

      assert.calledOnceWith(dbMock.collection, 'grants')
      assert.calledOnceWith(findOne, {
        _id: new ObjectId('67c8d9cbed26497691136292')
      })
      assert.deepStrictEqual(result, {
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
