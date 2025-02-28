import tls from 'node:tls'
import { MongoClient as Client } from 'mongodb'

export default class MongoClient extends Client {
  constructor ({ config }) {
    const cdpRootCa = config.get('cdpRootCa')

    let secureContext

    if (cdpRootCa) {
      secureContext = tls.createSecureContext()
    }

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
