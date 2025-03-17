import { ObjectId } from 'mongodb'

const toDocument = grant => ({
  _id: grant.grantId,
  name: grant.name,
  endpoints: grant.endpoints
})

export const toGrant = doc => ({
  grantId: doc._id.toString(),
  name: doc.name,
  endpoints: doc.endpoints
})

export const grantsCollection = 'grants'

export const createGrantRepository = (db) => {
  return {
    async add (grant) {
      const grantDocument = toDocument(grant)

      await db
        .collection(grantsCollection)
        .insertOne(grantDocument)
    },

    async findAll () {
      const results = await db
        .collection(grantsCollection)
        .find()
        .toArray()

      return results.map(toGrant)
    },

    async findById (grantId) {
      const result = await db
        .collection(grantsCollection)
        .findOne({
          _id: new ObjectId(grantId)
        })

      return result && toGrant(result)
    }
  }
}
