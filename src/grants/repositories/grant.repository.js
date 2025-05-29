import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../../common/mongo-client.js";
import { GrantDocument } from "../models/grant-document.js";
import { Grant } from "../models/grant.js";

export const toGrant = (doc) =>
  new Grant({
    code: doc.code,
    metadata: doc.metadata,
    actions: doc.actions,
    questions: doc.questions,
  });

export const collection = "grants";

export const save = async (grant) => {
  const document = new GrantDocument(grant);

  try {
    await db.collection(collection).insertOne(document);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw Boom.conflict(`Grant with code "${grant.code}" already exists`);
    }

    throw error;
  }
};

export const replace = async (grant) => {
  const document = new GrantDocument(grant);

  await db.collection(collection).replaceOne({ code: grant.code }, document);
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
