import { ObjectId } from 'mongodb'
import { GrantEndpoint } from '../entities/grant-endpoint.js'
import { Grant } from '../entities/grant.js'

/**
 * @import MongoClient from '../../common/mongo-client.js'
 */

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

  /*
   * Create new grant
   * @param {Partial<Grant>} partialGrant
   * @return {Promise<Grant>}
   */
  async create (partialGrant) {
    const grant = Grant.create({
      name: partialGrant.name,
      endpoints: partialGrant.endpoints.map(e => GrantEndpoint.create(e))
    })

    const result = await this.#collection.insertOne(grant)

    grant.id = result.insertedId.toString()

    return grant
  }

  /**
   * Get all grants
   * @return {Promise<Grant[]>}
   */
  async getAll () {
    const results = await this.#collection.find().toArray()

    return results.map(r => new Grant({
      id: r._id.toString(),
      name: r.name,
      endpoints: r.endpoints.map(e => new GrantEndpoint(e))
    }))
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

    return new Grant({
      id,
      name: result.name,
      endpoints: result.endpoints.map(e =>
        new GrantEndpoint(e)
      )
    })
  }
}
