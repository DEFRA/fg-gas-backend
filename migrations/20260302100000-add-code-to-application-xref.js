import { withTransaction } from "../src/common/with-transaction.js";

export const up = async (db) => {
  const xrefCollection = db.collection("application_xref");
  const applicationsCollection = db.collection("applications");

  await withTransaction(async (session) => {
    const cursor = xrefCollection.find({ code: { $exists: false } });

    const operations = [];
    for await (const doc of cursor) {
      const application = await applicationsCollection.findOne(
        { clientRef: doc.currentClientRef },
        { projection: { code: 1 }, session },
      );

      if (!application?.code) {
        continue;
      }

      operations.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { code: application.code } },
        },
      });
    }

    if (operations.length > 0) {
      await xrefCollection.bulkWrite(operations, { session });
    }

    await xrefCollection.updateMany(
      {},
      {
        $rename: {
          currentClientRef: "latestClientRef",
          currentClientId: "latestClientId",
        },
      },
      { session },
    );
  });

  await db.renameCollection("application_xref", "application_series");
};
