export const up = async (db) => {
  const query = { code: "woodland" };

  const applicationAmendmentStage = {
    code: "STAGE_APPLICATION_AMENDMENT",
    name: "Application amendment",
    description: "Application has been returned to the customer for amendments",
    statuses: [
      {
        code: "STATUS_RETURNED_TO_CUSTOMER",
        validFrom: [
          {
            code: "PHASE_PRE_AWARD:STAGE_REVIEWING_APPLICATION:STATUS_APPLICATION_RECEIVED",
            processes: [],
          },
        ],
      },
    ],
  };

  const returnedToCustomerStatus = {
    code: "PHASE_PRE_AWARD:STAGE_APPLICATION_AMENDMENT:STATUS_RETURNED_TO_CUSTOMER",
    source: "CW",
    mappedTo:
      "PHASE_PRE_AWARD:STAGE_APPLICATION_AMENDMENT:STATUS_RETURNED_TO_CUSTOMER",
  };

  await db.collection("grants").updateOne(query, {
    $push: {
      "phases.0.stages": applicationAmendmentStage,
      "externalStatusMap.phases.0.stages.0.statuses": returnedToCustomerStatus,
    },
  });
};
