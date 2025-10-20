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
              {
                code: "OFFER_IN_REVIEW",
                validFrom: ["OFFERED"],
              },
              {
                code: "OFFER_SENT",
                validFrom: ["OFFER_IN_REVIEW"],
              },
              {
                code: "OFFER_REJECTED",
                validFrom: ["OFFER_SENT"],
              },
              {
                code: "OFFER_WITHDRAWN",
                validFrom: ["OFFERED", "OFFER_IN_REVIEW", "OFFER_SENT"],
              },
            ],
          },
        ],
      },
      {
        code: "AWARD_AND_MONITORING",
        stages: [
          {
            code: "MONITORING",
            statuses: [
              {
                code: "ACTIVE",
                validFrom: ["PRE_AWARD:REVIEW:APPROVED"],
              },
              {
                code: "COMPLETED",
                validFrom: ["ACTIVE"],
              },
            ],
          },
        ],
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
    const questions = grant.phases?.[0]?.questions ?? {};

    const oldPhases = [
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
      { $set: { phases: oldPhases } },
    );
  }
};
