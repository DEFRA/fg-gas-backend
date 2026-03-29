export const up = async (db) => {
  const query = { code: "frps-private-beta" };

  const agreementTerminationStage = {
    code: "AGREEMENT_TERMINATION",
    name: "Agreement termination",
    description: "Stage to control the workflow for the termination process",
    statuses: [
      {
        code: "PRE_TERMINATION_CHECKS",
        validFrom: [
          {
            code: "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
            processes: [],
          },
        ],
      },
      {
        code: "TERMINATION_REQUESTED",
        validFrom: [
          {
            code: "POST_AGREEMENT_MONITORING:AGREEMENT_TERMINATION:PRE_TERMINATION_CHECKS",
            processes: ["REQUEST_AGREEMENT_TERMINATION"],
          },
        ],
      },
      {
        code: "AGREEMENT_TERMINATED",
        validFrom: [
          {
            code: "POST_AGREEMENT_MONITORING:AGREEMENT_TERMINATION:TERMINATION_REQUESTED",
            processes: ["APPLY_AGREEMENT_TERMINATION"],
          },
        ],
      },
    ],
  };

  const agreementTerminationExternalStatusMap = {
    code: "AGREEMENT_TERMINATION",
    statuses: [
      {
        code: "POST_AGREEMENT_MONITORING:AGREEMENT_TERMINATION:PRE_TERMINATION_CHECKS",
        source: "CW",
        mappedTo:
          "POST_AGREEMENT_MONITORING:AGREEMENT_TERMINATION:PRE_TERMINATION_CHECKS",
      },
      {
        code: "POST_AGREEMENT_MONITORING:AGREEMENT_TERMINATION:TERMINATION_REQUESTED",
        source: "CW",
        mappedTo:
          "POST_AGREEMENT_MONITORING:AGREEMENT_TERMINATION:TERMINATION_REQUESTED",
      },
      {
        code: "terminated",
        source: "AS",
        mappedTo:
          "POST_AGREEMENT_MONITORING:AGREEMENT_TERMINATION:AGREEMENT_TERMINATED",
      },
    ],
  };

  await db.collection("grants").updateOne(query, {
    $push: {
      "phases.1.stages": agreementTerminationStage,
      "externalStatusMap.phases.1.stages":
        agreementTerminationExternalStatusMap,
    },
  });
};
