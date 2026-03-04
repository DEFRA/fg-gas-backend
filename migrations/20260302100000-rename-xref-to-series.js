import { withTransaction } from "../src/common/with-transaction.js";

export const up = async (db) => {
  await db.collection("application_xref").drop();

  const applicationSeries = db.collection("application_series");
  await applicationSeries.createIndex({ clientRefs: 1 });
  await applicationSeries.createIndex({ latestClientRef: 1, code: 1 });
  await applicationSeries.createIndex({ latestClientId: 1 });

  await withTransaction(async (session) => {
    const date = new Date(Date.now()).toISOString();
    const applications = await db
      .collection("applications")
      .find({}, { projection: { clientRef: 1, code: 1 } })
      .toArray();

    if (!applications.length) {
      return;
    }

    await applicationSeries.insertMany(
      applications.map((application) => ({
        clientRefs: [application.clientRef],
        latestClientRef: application.clientRef,
        latestClientId: application._id.toString(),
        code: application.code,
        createdAt: date,
        updatedAt: date,
      })),
      { session },
    );
  });
};
