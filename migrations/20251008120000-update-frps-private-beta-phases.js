export const up = async (db) => {
  const collection = db.collection("grants");
  const grant = await collection.findOne({ code: "frps-private-beta" });

  if (grant) {
    const questions = grant.phases?.[0]?.questions ?? {};

    const newPhases = [
      {
        code: "PRE_AWARD",
        questions,
        stages: [
          {
            code: "REVIEW",
            statuses: [
              {
                code: "NEW",
              },
              {
                code: "IN_PROGRESS",
                validFrom: ["NEW"],
              },
              {
                code: "APPROVED",
                validFrom: ["IN_PROGRESS"],
                entryProcesses: ["GENERATE_AGREEMENT"],
              },
            ],
          },
          {
            code: "REVIEW_OFFER",
            statuses: [
              {
                code: "OFFERED",
                validFrom: ["PRE_AWARD:REVIEW:APPROVED"],
                entryProcesses: "STORE_AGREEMENT_CASE",
              },
            ],
          },
          {
            code: "AWAITING_AGREEMENT_RESPONSE",
            statuses: [],
          },
        ],
      },
      {
        code: "CLAIMS",
        questions: {},
        stages: [],
      },
    ];

    await collection.updateOne(
      { code: "frps-private-beta" },
      { $set: { phases: newPhases } },
    );
  }
};

export const down = async (db) => {
  const collection = db.collection("grants");
  const grant = await collection.findOne({ code: "frps-private-beta" });

  if (grant) {
    const oldPhases = [
      {
        code: "PHASE_1",
        questions: {},
        stages: [
          {
            code: "STAGE_1",
            statuses: [
              {
                code: "NEW",
              },
            ],
          },
        ],
      },
    ];

    await collection.updateOne(
      { code: "frps-private-beta" },
      { $set: { phases: oldPhases } },
    );
  }
};
