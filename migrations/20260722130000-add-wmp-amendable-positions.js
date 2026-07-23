export const up = async (db) => {
  await db.collection("grants").updateOne(
    { code: "woodland" },
    {
      $addToSet: {
        amendablePositions:
          "PHASE_PRE_AWARD:STAGE_APPLICATION_AMENDMENT:STATUS_RETURNED_TO_CUSTOMER",
      },
    },
  );
};
