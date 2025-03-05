import { db } from '../common/db.js'

const toDocument = grant => ({
  _id: grant.grantId,
  name: grant.name,
  endpoints: grant.endpoints
})

const toGrant = doc => ({
  grantId: doc._id.toString(),
  name: doc.name,
  endpoints: doc.endpoints
})

const collection = 'grants'

export const grantRepository = {
  async add (grant) {
    const grantDocument = toDocument(grant)

    await db
      .collection(collection)
      .insertOne(grantDocument)
  },

  async findAll () {
    const results = await db
      .collection(collection)
      .find()
      .toArray()

    return results.map(toGrant)
  },

  async findById (grantId) {
    const result = await db
      .collection(collection)
      .findOne({
        _id: grantId
      })

    return result && toGrant(result)
  }
}
