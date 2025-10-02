import { db } from "../../common/mongo-client.js";
import { EventPublication, EventPublicationStatus } from "../models/event-publication.js";

const COLLECTION_NAME = "event_publication_outbox";

export const fetchPendingEvents = async (claimToken) => {
  await db.collection(COLLECTION_NAME).updateMany(
    {
      status: { $nin: [EventPublicationStatus.PROCESSING, EventPublicationStatus.COMPLETED] },
      claimToken: { $eq: null },
    },
    { $set: { status: EventPublicationStatus.PROCESSING, claimToken, claimedAt: new Date() } },
  );

  const documents = await db
    .collection(COLLECTION_NAME)
    .find({ claimToken })
    .toArray();
  return documents.map((doc) => EventPublication.fromDocument(doc));
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
