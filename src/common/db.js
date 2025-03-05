import tls from 'node:tls'
import { MongoClient } from 'mongodb'
import { config } from './config.js'

export const mongoClient = new MongoClient(config.get('mongoUri'), {
  retryWrites: false,
  readPreference: 'secondary',
  secureContext: tls.createSecureContext()
})

export const db = mongoClient.db(config.get('mongoDatabase'))
