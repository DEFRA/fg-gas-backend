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

  // PRE_TERMINATION_CHECKS belongs in the MONITORING stage's externalStatusMap
  // because the transition originates from AGREEMENT_ACCEPTED in MONITORING
  const preTerminationChecksStatus = {
    code: "POST_AGREEMENT_MONITORING:AGREEMENT_TERMINATION:PRE_TERMINATION_CHECKS",
    source: "CW",
    mappedTo:
      "POST_AGREEMENT_MONITORING:AGREEMENT_TERMINATION:PRE_TERMINATION_CHECKS",
  };

  // AGREEMENT_TERMINATION stage only contains statuses that originate from within it
  const agreementTerminationExternalStatusMap = {
    code: "AGREEMENT_TERMINATION",
    statuses: [
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

  // First update: Add new stage and PRE_TERMINATION_CHECKS to existing MONITORING stage
  await db.collection("grants").updateOne(query, {
    $push: {
      "phases.1.stages": agreementTerminationStage,
      // Add PRE_TERMINATION_CHECKS to existing MONITORING stage (phases.1.stages.0)
      "externalStatusMap.phases.1.stages.0.statuses":
        preTerminationChecksStatus,
    },
  });

  // Second update: Add new AGREEMENT_TERMINATION stage to externalStatusMap
  await db.collection("grants").updateOne(query, {
    $push: {
      "externalStatusMap.phases.1.stages":
        agreementTerminationExternalStatusMap,
    },
  });
};
