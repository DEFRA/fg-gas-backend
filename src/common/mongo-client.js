import { MongoClient as Client } from 'mongodb'

export default class MongoClient extends Client {
  constructor ({ config }) {
    const cdpRootCa = config.get('cdpRootCa')

    const secureContext = cdpRootCa
      ? {
          ca: [cdpRootCa]
        }
      : undefined

    super(config.get('mongoUri'), {
      retryWrites: false,
      readPreference: 'secondary',
      secureContext
    })
  }

  async dispose () {
    await this.close(true)
  }
}
