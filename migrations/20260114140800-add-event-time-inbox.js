import { withTransaction } from "../src/common/with-transaction.js";

export const up = async (db) => {
  const collection = db.collection("inbox");
  const query = {};

  await withTransaction(async (session) => {
    await collection.updateMany(
      query,
      [
        {
          $set: {
            eventTime: "$event.time",
          },
        },
      ],
      {
        session,
      },
    );
  });
};
