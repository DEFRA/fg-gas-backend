import { after, before, describe, it } from 'node:test'
import { assert } from '../common/assert.js'
import { createGrantRepository, grantsCollection, toGrant } from './grant-repository.js'
import { MongoClient } from 'mongodb'
import { MongoDBContainer } from '@testcontainers/mongodb'
import tls from 'node:tls'
import { config } from '../common/config.js'

describe('grantRepository integration tests', () => {
  let mongoClient
  let mongodbContainer
  let db
  let grantRepository

  const grantsFixture =
    [
      {
        name: 'test 1',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      },
      {
        name: 'test 2',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      }
    ]

  before(async () => {
    mongodbContainer = await new MongoDBContainer('mongo:6.0.1').start()
    mongoClient = new MongoClient(mongodbContainer.getConnectionString(), {
      retryWrites: false,
      readPreference: 'secondary',
      secureContext: tls.createSecureContext(),
      directConnection: true
    })
    db = mongoClient.db(config.get('mongoDatabase'))
    grantRepository = createGrantRepository(db)
  })

  after(async () => {
    await mongoClient.close()
    await mongodbContainer.stop()
  })

  describe('add', () => {
    before(async () => {
      await db.collection(grantsCollection).deleteMany({})
    })

    it('stores a Grant in the repository', async () => {
      await grantRepository.add({
        grantId: '1',
        name: 'test',
        endpoints: [{
          method: 'GET',
          name: 'test',
          url: 'http://localhost'
        }]
      })

      const results = await db
        .collection(grantsCollection)
        .find()
        .toArray()

      assert.strictEqual(results.length, 1)
      assert.strictEqual(results[0].name, 'test')
      const grants = results.map(toGrant)
      assert.strictEqual(grants.length, 1)
      assert.strictEqual(grants[0].name, 'test')
    })
  })

  describe('findAll', () => {
    before(async () => {
      await db.collection(grantsCollection).deleteMany({})
    })

    it('finds all the grants in the repository', async () => {
      await db
        .collection(grantsCollection)
        .insertMany(grantsFixture)
      const grants = await grantRepository.findAll()
      assert.strictEqual(grants.length, 2)
      assert.strictEqual(grants[0].name, 'test 1')
      assert.strictEqual(grants[1].name, 'test 2')
    })
  })

  describe('findById', () => {
    before(async () => {
      await db.collection(grantsCollection).deleteMany({})
    })

    it('finds a Grant in the repository', async () => {
      await db
        .collection(grantsCollection)
        .insertMany(grantsFixture)

      const results = await db
        .collection(grantsCollection)
        .find()
        .toArray()

      const grant = await grantRepository.findById(results[1]._id)
      assert.strictEqual(grant.name, 'test 2')
    })
  })
})
