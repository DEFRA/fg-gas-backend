export const up = (db) => {
  const collection = db.collection("grants");
  const query = { code: "frps-private-beta" };
  const withdrawRequestedStatus = {
    code: "WITHDRAW_REQUESTED",
    validFrom: [
      "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
      "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
      "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
      "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
    ],
    processes: ["UPDATE_AGREEMENT_CASE"],
  };

  const applicationWithdrawnStatus = {
    code: "APPLICATION_WITHDRAWN",
    validFrom: [
      "PRE_AWARD:REVIEW_APPLICATION:WITHDRAW_REQUESTED",
      "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
      "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
      "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
      "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
    ],
    processes: ["UPDATE_AGREEMENT_CASE"],
  };

  {
    const arrayFilters = [
      { "phase.code": "PRE_AWARD" },
      { "stage.code": "REVIEW_APPLICATION" },
    ];

    collection.updateOne(
      query,
      {
        $push: {
          "phases.$[phase].stages.$[stage].statuses": {
            $each: [withdrawRequestedStatus, applicationWithdrawnStatus],
          },
        },
      },
      {
        arrayFilters,
      },
    );

    collection.updateOne(
      query,
      {
        $push: {
          "externalStatusMap.phases.$[phase].stages.$[stage].statuses": {
            $each: [
              {
                code: "withdrawn",
                source: "AS",
                mappedTo: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_WITHDRAWN",
              },
              {
                code: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAW_REQUESTED",
                source: "CW",
                mappedTo: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAW_REQUESTED",
              },
            ],
          },
        },
      },
      {
        arrayFilters,
      },
    );
  }

  {
    const arrayFilters = [
      { "phase.code": "PRE_AWARD" },
      { "stage.code": "REVIEW_OFFER" },
    ];

    collection.updateOne(
      query,
      {
        $push: {
          "externalStatusMap.phases.$[phase].stages.$[stage].statuses": {
            $each: [
              {
                code: "withdrawn",
                source: "AS",
                mappedTo: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_WITHDRAWN",
              },
              {
                code: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAW_REQUESTED",
                source: "CW",
                mappedTo: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAW_REQUESTED",
              },
            ],
          },
        },
      },
      {
        arrayFilters,
      },
    );
  }

  {
    const arrayFilters = [
      { "phase.code": "PRE_AWARD" },
      { "stage.code": "CUSTOMER_AGREEMENT_REVIEW" },
    ];

    collection.updateOne(
      query,
      {
        $push: {
          "externalStatusMap.phases.$[phase].stages.$[stage].statuses": {
            $each: [
              {
                code: "withdrawn",
                source: "AS",
                mappedTo: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_WITHDRAWN",
              },
              {
                code: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAW_REQUESTED",
                source: "CW",
                mappedTo: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAW_REQUESTED",
              },
            ],
          },
        },
      },
      {
        arrayFilters,
      },
    );
  }
};
