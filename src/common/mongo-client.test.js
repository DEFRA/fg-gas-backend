import { describe, it } from 'node:test'
import MongoClient from './mongo-client.js'

describe('MongoClient', () => {
  describe('constructor', () => {
    it('creates a client without CDP root certificate', t => {
      const config = {
        get: t.mock.fn((key) => ({
          cdpRootCa: null,
          mongoUri: 'mongodb://localhost:27017'
        }[key]))
      }

      const mongoClient = new MongoClient({ config })

      t.assert.equal(mongoClient.s.options.secureContext, undefined)
    })

    it('creates a client with CDP root certificate', t => {
      const config = {
        get: t.mock.fn((key) => ({
          cdpRootCa: 'cert',
          mongoUri: 'mongodb://localhost:27017'
        }[key]))
      }

      const mongoClient = new MongoClient({ config })

      t.assert.deepStrictEqual(mongoClient.s.options.secureContext, {
        ca: ['cert']
      })
    })
  })

  describe('dispose', () => {
    it('closes the connection', async t => {
      const config = {
        get: t.mock.fn((key) => ({
          mongoUri: 'mongodb://localhost:27017'
        }[key]))
      }

      const mongoClient = new MongoClient({
        config
      })

      t.mock.method(mongoClient, 'close')

      await mongoClient.dispose()

      t.assert.equal(mongoClient.close.mock.calls.length, 1)
      t.assert.deepStrictEqual(mongoClient.close.mock.calls[0].arguments, [
        true
      ])
    })
  })
})
