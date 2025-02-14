import { ObjectId } from 'mongodb'
import GrantEndpoint from '../entities/grant-endpoint.js'
import Grant from '../entities/grant.js'

export default class GrantRepository {
  #collection

  /**
   * @param {Object} args
   * @param {Object} args.config
   * @param {MongoClient} args.mongoClient
   */
  constructor ({ config, mongoClient }) {
    this.#collection = mongoClient
      .db(config.get('mongoDatabase'))
      .collection('grants')
  }

  /**
   * @param {string} id
   * @return {Promise<Grant | null>}
   */
  async getById (id) {
    const result = await this.#collection.findOne({
      _id: new ObjectId(id)
    })

    if (result === null) {
      return null
    }

    return Grant.create({
      id,
      name: result.name,
      endpoints: result.endpoints.map(endpoint =>
        GrantEndpoint.create({
          name: endpoint.name,
          method: endpoint.method,
          url: endpoint.url
        })
      )
    })
  }
}
