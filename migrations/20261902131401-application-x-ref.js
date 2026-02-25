import { withTransaction } from "../src/common/with-transaction.js";

export const up = async (db) => {
  const applicationXref = db.collection("application_xref");
  await applicationXref.createIndex({ clientRefs: 1 });
  await applicationXref.createIndex({ currentClientRef: 1 });
  await applicationXref.createIndex({ currentClientId: 1 });

  await withTransaction(async (session) => {
    const date = new Date(Date.now()).toISOString();
    const applications = await db
      .collection("applications")
      .find({}, { projection: { clientRef: 1 } })
      .toArray();

    if (!applications.length) {
      return;
    }

    await applicationXref.insertMany(
      applications.map((application) => ({
        clientRefs: [application.clientRef],
        currentClientRef: application.clientRef,
        currentClientId: application._id,
        createdAt: date,
        updatedAt: date,
      })),
      { session },
    );
  });
};
