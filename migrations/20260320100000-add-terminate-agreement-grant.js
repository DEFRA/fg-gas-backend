export const up = async (db) => {
  const query = { code: "frps-private-beta" };

  // Add new statuses to POST_AGREEMENT_MONITORING:MONITORING
  await db.collection("grants").updateOne(query, {
    $push: {
      "phases.1.stages.0.statuses": {
        $each: [
          {
            code: "TERMINATION_REQUESTED",
            validFrom: [
              {
                code: "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
                processes: ["REQUEST_AGREEMENT_TERMINATION"],
              },
            ],
          },
          {
            code: "AGREEMENT_TERMINATED",
            validFrom: [
              {
                code: "POST_AGREEMENT_MONITORING:MONITORING:TERMINATION_REQUESTED",
                processes: ["APPLY_AGREEMENT_TERMINATION"],
              },
            ],
          },
        ],
      },
    },
  });

  // Add externalStatusMap entries for POST_AGREEMENT_MONITORING:MONITORING
  await db.collection("grants").updateOne(query, {
    $push: {
      "externalStatusMap.phases.1.stages.0.statuses": {
        $each: [
          {
            code: "POST_AGREEMENT_MONITORING:MONITORING:TERMINATION_REQUESTED",
            source: "CW",
            mappedTo:
              "POST_AGREEMENT_MONITORING:MONITORING:TERMINATION_REQUESTED",
          },
          {
            code: "terminated",
            source: "AS",
            mappedTo:
              "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_TERMINATED",
          },
        ],
      },
    },
  });
};
