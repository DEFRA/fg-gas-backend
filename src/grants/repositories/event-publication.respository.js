import { db } from "../../common/mongo-client.js";
import { EventPublication } from "../models/event-publication.js";

const COLLECTION_NAME = "event_publication_outbox";

export const fetchPendingEvents = async (claimToken) => {
  await db
    .collection(COLLECTION_NAME)
    .updateMany(
      {
        status: { $nin: ["PROCESSING", "COMPLETE"] },
        claimToken: { $eq: null },
      },
      { $set: { status: "PROCESSING", claimToken, claimedAt: new Date() } },
    );

  const documents = await db
    .collection(COLLECTION_NAME)
    .find({ claimToken })
    .toArray();
  return documents;
};

export const insert = async (eventPublication) => {
  const collection = await db.collection(COLLECTION_NAME);
  const document = eventPublication.toDocument();
  await collection.insertOne(document);
  return eventPublication;
};

export const findById = async (id) => {
  const collection = await db.collection(COLLECTION_NAME);
  const document = await collection.findOne({ _id: id });
  return document ? EventPublication.fromDocument(document) : null;
};

export const findPendingEvents = async (limit = 100) => {
  const collection = await db.collection(COLLECTION_NAME);
  const documents = await collection
    .find({ status: "PENDING" })
    .sort({ publicationDate: 1 })
    .limit(limit)
    .toArray();

  return documents.map((doc) => EventPublication.fromDocument(doc));
};

export const update = async (eventPublication) => {
  const collection = await db.collection(COLLECTION_NAME);
  const document = eventPublication.toDocument();
  const { _id, ...updateDoc } = document;

  await collection.updateOne({ _id }, { $set: updateDoc });

  return eventPublication;
};

export const deleteById = async (id) => {
  const collection = await db.collection(COLLECTION_NAME);
  const result = await collection.deleteOne({ _id: id });
  return result.deletedCount > 0;
};

export const findByStatus = async (status, limit = 100) => {
  const collection = await db.collection(COLLECTION_NAME);
  const documents = await collection
    .find({ status })
    .sort({ publicationDate: 1 })
    .limit(limit)
    .toArray();

  return documents.map((doc) => EventPublication.fromDocument(doc));
};

export const findFailedEvents = async (maxAttempts = 3, limit = 100) => {
  const collection = await db.collection(COLLECTION_NAME);
  const documents = await collection
    .find({
      status: "FAILED",
      completionAttempts: { $lt: maxAttempts },
    })
    .sort({ lastResubmissionDate: 1 })
    .limit(limit)
    .toArray();

  return documents.map((doc) => EventPublication.fromDocument(doc));
};
