import { db } from "../../common/mongo-client.js";
import {
  EventPublication,
  EventPublicationStatus,
} from "../models/event-publication.js";

const COLLECTION_NAME = "event_publication_outbox";

export const fetchPendingEvents = async (claimToken) => {
  const omitStatuses = [
    EventPublicationStatus.PROCESSING,
    EventPublicationStatus.COMPLETED,
    EventPublicationStatus.RESUBMITTED,
    EventPublicationStatus.FAILED,
  ];

  // TODO this will need to only work on one event at a time
  await db.collection(COLLECTION_NAME).updateMany(
    {
      status: { $nin: omitStatuses },
      claimToken: { $eq: null },
    },
    {
      $set: {
        status: EventPublicationStatus.PROCESSING,
        claimToken,
        claimedAt: new Date(),
      },
    },
  );

  const documents = await db
    .collection(COLLECTION_NAME)
    .find({ claimToken })
    .toArray();
  return documents.map((doc) => EventPublication.fromDocument(doc));
};

// Move failed events to resubmitted status
export const updateFailedEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
    {
      status: EventPublicationStatus.FAILED,
      claimToken: { $eq: null },
    },
    {
      $set: { status: EventPublicationStatus.RESUBMITTED },
      $inc: { completionAttempts: 1 },
    },
  );
  return results;
};

// Move resubmitted events to published status
export const updateResubmittedEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
    {
      status: EventPublicationStatus.RESUBMITTED,
      claimToken: { $eq: null },
    },
    {
      $set: { status: EventPublicationStatus.PUBLISHED },
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
