import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../common/db.js";

const toDocument = (grant) => ({
  code: grant.code,
  metadata: {
    description: grant.metadata.description,
    startDate: grant.metadata.startDate,
  },
  actions: grant.actions,
  questions: grant.questions,
});

export const toGrant = (doc) => ({
  code: doc.code,
  metadata: {
    description: doc.metadata.description,
    startDate: doc.metadata.startDate,
  },
  actions: doc.actions,
  questions: doc.questions,
});

export const collection = "grants";

export const add = async (grant) => {
  const grantDocument = toDocument(grant);

  try {
    await db.collection(collection).insertOne(grantDocument);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw Boom.conflict(`Grant with code "${grant.code}" already exists`);
    }

    throw Boom.internal(error);
  }
};

export const findAll = async () => {
  const results = await db.collection(collection).find().toArray();

  return results.map(toGrant);
};

export const findByCode = async (code) => {
  const result = await db.collection(collection).findOne({
    code,
  });

  return result && toGrant(result);
};
