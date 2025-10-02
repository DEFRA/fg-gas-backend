import { db } from "../../common/mongo-client.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";

const COLLECTION_NAME = "event_publication_outbox";
const MAX_RETRIES = 5;

export const fetchPendingEvents = async (claimToken) => {
  const omitStatuses = [
    OutboxStatus.PROCESSING,
    OutboxStatus.COMPLETED,
    OutboxStatus.RESUBMITTED,
    OutboxStatus.FAILED,
    OutboxStatus.DEAD,
  ];

  // TODO - does this need to be a single update?
  await db.collection(COLLECTION_NAME).updateMany(
    {
      status: { $nin: omitStatuses },
      claimToken: { $eq: null },
      completionAttempts: { $lte: MAX_RETRIES },
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

// Move events that have been retried to dead status
export const updateDeadEvents = async () => {
  const results = await db
    .collection(COLLECTION_NAME)
    .updateMany(
      { completionAttempts: { $gt: MAX_RETRIES } },
      { $set: { status: OutboxStatus.DEAD } },
    );
  return results;
};

// Move failed events to resubmitted status
export const updateFailedEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
    {
      status: OutboxStatus.FAILED,
    },
    {
      $set: { status: OutboxStatus.RESUBMITTED },
    },
  );
  return results;
};

// Move resubmitted events to published status
export const updateResubmittedEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
    {
      status: OutboxStatus.RESUBMITTED,
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
