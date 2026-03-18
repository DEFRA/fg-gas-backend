import { withTransaction } from "../src/common/with-transaction.js";

export const up = async (db) => {
  await withTransaction(async (session) => {
    // For applications with replacementAllowed = true, set currentStatus to "APPLICATION_AMEND"
    await db.collection("applications").updateMany(
      { replacementAllowed: true },
      {
        $set: {
          currentStatus: "APPLICATION_AMEND",
        },
      },
      { session },
    );

    // Remove replacementAllowed from all application documents
    await db.collection("applications").updateMany(
      { replacementAllowed: { $exists: true } },
      {
        $unset: {
          replacementAllowed: "",
        },
      },
      { session },
    );

    // For each grant, remove replacementAllowed from each status in all phases/stages
    const grants = await db.collection("grants").find({}).toArray();

    for (const grant of grants) {
      for (const phase of grant.phases) {
        for (const stage of phase.stages) {
          stage.statuses = stage.statuses.map((status) => {
            const { replacementAllowed, ...rest } = status;
            return rest;
          });
        }
      }

      await db.collection("grants").updateOne(
        { _id: grant._id },
        {
          $set: {
            phases: grant.phases,
            amendablePositions: [
              "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_AMEND",
              "PRE_AWARD:REVIEW_OFFER:APPLICATION_AMEND",
              "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:APPLICATION_AMEND",
            ],
          },
        },
        { session },
      );
    }
  });
};
