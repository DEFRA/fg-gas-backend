import { withTransaction } from "../src/common/with-transaction.js";

export const up = async (db) => {
  await withTransaction(async (session) => {
    // update applications
    await db.collection("applications").updateMany(
      {},
      [
        {
          $set: {
            replacementAllowed: {
              $ifNull: ["$replacementAllowed", false],
            },
          },
        },
      ],
      { session },
    );

    const grants = await db.collection("grants").find({}).toArray();
    // update grant def
    for (const grant of grants) {
      for (const phase of grant.phases) {
        for (const stage of phase.stages) {
          stage.statuses = stage.statuses.map((status) => {
            return {
              ...status,
              replacementAllowed: false,
            };
          });
        }
      }

      await db
        .collection("grants")
        .updateOne(
          { _id: grant._id },
          { $set: { phases: grant.phases } },
          { session },
        );
    }
  });
};
