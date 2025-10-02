import { db } from "../../common/mongo-client.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";

const COLLECTION_NAME = "event_publication_outbox";

export const fetchPendingEvents = async (claimToken) => {
  const omitStatuses = [
    OutboxStatus.PROCESSING,
    OutboxStatus.COMPLETED,
    OutboxStatus.RESUBMITTED,
    OutboxStatus.FAILED,
  ];

  // TODO this will need to only work on one event at a time
  await db.collection(COLLECTION_NAME).updateMany(
    {
      status: { $nin: omitStatuses },
      claimToken: { $eq: null },
    },
    {
      $set: {
        status: OutboxStatus.PROCESSING,
        claimToken,
        claimedAt: new Date(),
      },
    },
  );

  const documents = await db
    .collection(COLLECTION_NAME)
    .find({ claimToken })
    .toArray();
  return documents.map((doc) => Outbox.fromDocument(doc));
};

// Move failed events to resubmitted status
export const updateFailedEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
    {
      status: OutboxStatus.FAILED,
      claimToken: { $eq: null },
    },
    {
      $set: { status: OutboxStatus.RESUBMITTED },
      $inc: { completionAttempts: 1 },
    },
  );
  return results;
};

// Move resubmitted events to published status
export const updateResubmittedEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
    {
      status: OutboxStatus.RESUBMITTED,
      claimToken: { $eq: null },
    },
    {
      $set: { status: OutboxStatus.PUBLISHED },
      $inc: { completionAttempts: 1 },
    },
  );
  return results;
};

export const insertMany = async (events, session) => {
  return db.collection(COLLECTION_NAME).insertMany(
    events.map((event) => event.toDocument()),
    { session },
  );
};

export const insert = async (eventPublication, session) => {
  const document = eventPublication.toDocument();
  return db.collection(COLLECTION_NAME).insertOne(document, { session });
};

export const update = async (eventPublication) => {
  const document = eventPublication.toDocument();
  const { _id, ...updateDoc } = document;

  return db.collection(COLLECTION_NAME).updateOne({ _id }, { $set: updateDoc });
};
