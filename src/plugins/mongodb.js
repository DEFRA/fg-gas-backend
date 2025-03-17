'use strict'

import tls from 'node:tls'
import { logger } from '../common/logger.js'
import { MongoClient } from 'mongodb'

export const mongoPlugin = {
  name: 'mongoPlugin',
  version: '1.0.0',
  register: async function (server, options) {
    const { uri, dbName } = options

    if (!uri || !dbName) {
      throw new Error('MongoDB URI and Database Name must be provided')
    }

    try {
      // Create MongoDB client instance
      const client = new MongoClient(uri, {
        retryWrites: false,
        readPreference: 'secondary',
        secureContext: tls.createSecureContext()
      })

      // Connect to MongoDB
      await client.connect()
      logger.info('MongoDB Connected')

      // Make the DB accessible throughout the app
      server.app.db = client.db(dbName)

      // Close MongoDB connection when server stops
      server.ext('onPostStop', async () => {
        await client.close()
        logger.info('MongoDB Connection Closed')
      })
    } catch (err) {
      logger.error(err, 'Could not connect to MongoDB')
      throw err
    }
  }
}
