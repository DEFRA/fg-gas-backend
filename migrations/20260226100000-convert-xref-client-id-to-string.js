import { withTransaction } from "../src/common/with-transaction.js";

export const up = async (db) => {
  const collection = db.collection("application_xref");

  await withTransaction(async (session) => {
    const cursor = collection.find({ currentClientId: { $type: "objectId" } });

    const operations = [];
    for await (const doc of cursor) {
      operations.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { currentClientId: doc.currentClientId.toString() } },
        },
      });
    }

    if (operations.length > 0) {
      await collection.bulkWrite(operations, { session });
    }
  });
};
