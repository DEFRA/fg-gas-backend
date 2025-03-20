import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../common/db.js";

const toDocument = (grant) => ({
  code: grant.code,
  name: grant.name,
  endpoints: grant.endpoints,
});

export const toGrant = (doc) => ({
  code: doc.code,
  name: doc.name,
  endpoints: doc.endpoints,
});

export const collection = "grants";

export const grantRepository = {
  async add(grant) {
    const grantDocument = toDocument(grant);

    try {
      await db.collection(collection).insertOne(grantDocument);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw Boom.conflict(`Grant with code "${grant.code}" already exists`);
      }

      throw Boom.internal(error);
    }
  },

  async findAll() {
    const results = await db.collection(collection).find().toArray();

    return results.map(toGrant);
  },

  async findByCode(code) {
    const result = await db.collection(collection).findOne({
      code,
    });

    return result && toGrant(result);
  },
};
