import { db } from "./mongo-client.js";

const collection = "outbox";

export const insertMany = async (events, session) => {
  return db.collection(collection).insertMany(
    events.map((event) => event.toDocument()),
    { session },
  );
};
