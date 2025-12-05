import { withTransaction } from "../src/common/with-transaction.js";

export const up = async (db) => {
  const collection = db.collection("grants");
  const query = { code: "frps-private-beta" };
  const withdrawRequestedStatus = {
    code: "WITHDRAWAL_REQUESTED",
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
      "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
      "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
      "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
      "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
      "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
    ],
    processes: ["UPDATE_AGREEMENT_CASE"],
  };

  await withTransaction(async(session) => {
    await collection.updateOne(
      query,
      {
        $push: {
          "phases.$[phase].stages.$[stage].statuses.$[status].validFrom": "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_WITHDRAWN"
        },
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "REVIEW_APPLICATION" },
          { "status.code": "IN_REVIEW" }
        ], session
      },
    ); 

    await collection.updateOne(
      query,
      {
        $push: {
          "phases.$[phase].stages.$[stage].statuses": {
            $each: [withdrawRequestedStatus, applicationWithdrawnStatus],
          },
        },
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "REVIEW_APPLICATION" },
        ], session
      },
    );

    await collection.updateOne(
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
                code: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
                source: "CW",
                mappedTo: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
              },
            ],
          },
        },
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "REVIEW_APPLICATION" },
        ], session
      },
    );

    await collection.updateOne(
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
                code: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
                source: "CW",
                mappedTo: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
              },
            ],
          },
        },
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "REVIEW_OFFER" },
        ], session
      },
    );

    await collection.updateOne(
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
                code: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
                source: "CW",
                mappedTo: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
              },
            ],
          },
        },
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "CUSTOMER_AGREEMENT_REVIEW" },
        ], session
      },
    );
  });
};

export const down = async (db) => { 
  const collection = db.collection("grants");
  const query = { code: "frps-private-beta" };
  await withTransaction((session) => {
    collection.updateOne(
      query,
      {
        $pop: { "phases.$[phase].stages.$[stage].statuses.$[status].validFrom": 1 } 
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "REVIEW_APPLICATION" },
          { "status.code": "IN_REVIEW" },
        ], session
      },
    ); 

    collection.updateOne(
      query,
      {
        $pop: {
          "phases.$[phase].stages.$[stage].statuses": 2,
        },
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "REVIEW_APPLICATION" },
        ], session
      },
    );

    collection.updateOne(
      query,
      {
        $push: {
          "externalStatusMap.phases.$[phase].stages.$[stage].statuses": 2
        },
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "REVIEW_APPLICATION" },
        ], session
      },
    );

    collection.updateOne(
      query,
      {
        $push: {
          "externalStatusMap.phases.$[phase].stages.$[stage].statuses": 2 
        },
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "REVIEW_OFFER" },
        ], session
      },
    );

    collection.updateOne(
      query,
      {
        $push: {
          "externalStatusMap.phases.$[phase].stages.$[stage].statuses": 2 
        },
      },
      {
        arrayFilters: [
          { "phase.code": "PRE_AWARD" },
          { "stage.code": "CUSTOMER_AGREEMENT_REVIEW" },
        ], session
      },
    );
  });
};