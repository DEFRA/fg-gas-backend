const reviewApplicationStatuses = [
  {
    code: "APPLICATION_RECEIVED",
    validFrom: [],
  },
  {
    code: "IN_REVIEW",
    validFrom: [
      {
        code: "APPLICATION_RECEIVED",
        processes: [],
      },
      {
        code: "APPLICATION_REJECTED",
        processes: [],
      },
      {
        code: "ON_HOLD",
        processes: [],
      },
    ],
  },
  {
    code: "AGREEMENT_GENERATING",
    validFrom: [
      {
        code: "IN_REVIEW",
        processes: ["GENERATE_OFFER"],
      },
    ],
  },
  {
    code: "ON_HOLD",
    validFrom: [
      {
        code: "IN_REVIEW",
        processes: [],
      },
    ],
  },
  {
    code: "APPLICATION_REJECTED",
    validFrom: [
      {
        code: "IN_REVIEW",
        processes: [],
      },
    ],
  },
  {
    code: "APPLICATION_AMEND",
    validFrom: [
      {
        code: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
        processes: [],
      },
      {
        code: "PRE_AWARD:REVIEW_APPLICATION:ON_HOLD",
        processes: [],
      },
    ],
  },
  {
    code: "WITHDRAWAL_REQUESTED",
    validFrom: [
      {
        code: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
        processes: ["REQUEST_APPLICATION_WITHDRAWAL"],
      },
      {
        code: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
        processes: ["REQUEST_APPLICATION_WITHDRAWAL"],
      },
    ],
  },
  {
    code: "APPLICATION_WITHDRAWN",
    validFrom: [
      {
        code: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
        processes: ["WITHDRAW_AGREEMENT"],
      },
    ],
  },
];

const reviewOfferStatuses = [
  {
    code: "AGREEMENT_DRAFTED",
    validFrom: [
      {
        code: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
        processes: ["STORE_AGREEMENT_CASE"],
      },
      {
        code: "APPLICATION_REJECTED",
        processes: [],
      },
    ],
  },
  {
    code: "AMENDMENT_REQUESTED",
    validFrom: [
      {
        code: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
        processes: ["REQUEST_AGREEMENT_CANCELLATION"],
      },
    ],
  },
  {
    code: "APPLICATION_AMEND",
    validFrom: [
      {
        code: "PRE_AWARD:REVIEW_OFFER:AMENDMENT_REQUESTED",
        processes: ["CANCEL_AGREEMENT"],
      },
    ],
  },
  {
    code: "APPLICATION_REJECTED",
    validFrom: [
      {
        code: "AGREEMENT_DRAFTED",
        processes: [],
      },
    ],
  },
  {
    code: "WITHDRAWAL_REQUESTED",
    validFrom: [
      {
        code: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
        processes: ["REQUEST_APPLICATION_WITHDRAWAL"],
      },
    ],
  },
  {
    code: "APPLICATION_WITHDRAWN",
    validFrom: [
      {
        code: "PRE_AWARD:REVIEW_OFFER:WITHDRAWAL_REQUESTED",
        processes: ["WITHDRAW_AGREEMENT"],
      },
    ],
  },
];

const customerAgreementReviewStatuses = [
  {
    code: "AGREEMENT_OFFERED",
    validFrom: [
      {
        code: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
        processes: [],
      },
    ],
  },
  {
    code: "AMENDMENT_REQUESTED",
    validFrom: [
      {
        code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
        processes: ["REQUEST_AGREEMENT_CANCELLATION"],
      },
    ],
  },
  {
    code: "APPLICATION_AMEND",
    validFrom: [
      {
        code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AMENDMENT_REQUESTED",
        processes: ["CANCEL_AGREEMENT"],
      },
    ],
  },
  {
    code: "WITHDRAWAL_REQUESTED",
    validFrom: [
      {
        code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
        processes: ["REQUEST_APPLICATION_WITHDRAWAL"],
      },
    ],
  },
  {
    code: "APPLICATION_WITHDRAWN",
    validFrom: [
      {
        code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:WITHDRAWAL_REQUESTED",
        processes: ["WITHDRAW_AGREEMENT"],
      },
    ],
  },
];

const postAgreementMonitoringStatuses = [
  {
    code: "AGREEMENT_ACCEPTED",
    validFrom: [
      {
        code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
        processes: ["ACCEPT_AGREEMENT"],
      },
    ],
  },
];

const externalMapping = [
  {
    code: "PRE_AWARD",
    stages: [
      {
        code: "REVIEW_APPLICATION",
        statuses: [
          {
            code: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
            source: "CW",
            mappedTo: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
          },
          {
            code: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
            source: "CW",
            mappedTo: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
          },
          {
            code: "PRE_AWARD:REVIEW_APPLICATION:ON_HOLD",
            source: "CW",
            mappedTo: "PRE_AWARD:REVIEW_APPLICATION:ON_HOLD",
          },
          {
            code: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_REJECTED",
            source: "CW",
            mappedTo: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_REJECTED",
          },
          {
            code: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_AMEND",
            source: "CW",
            mappedTo: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_AMEND",
          },
          {
            code: "offered",
            source: "AS",
            mappedTo: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
          },
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
      {
        code: "REVIEW_OFFER",
        statuses: [
          {
            code: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
            source: "CW",
            mappedTo: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
          },
          {
            code: "PRE_AWARD:REVIEW_OFFER:AMENDMENT_REQUESTED",
            source: "CW",
            mappedTo: "PRE_AWARD:REVIEW_OFFER:AMENDMENT_REQUESTED",
          },
          {
            code: "PRE_AWARD:REVIEW_OFFER:APPLICATION_REJECTED",
            source: "CW",
            mappedTo: "PRE_AWARD:REVIEW_OFFER:APPLICATION_REJECTED",
          },
          {
            code: "cancelled",
            source: "AS",
            mappedTo: "PRE_AWARD:REVIEW_OFFER:APPLICATION_AMEND",
          },
          {
            code: "withdrawn",
            source: "AS",
            mappedTo: "PRE_AWARD:REVIEW_OFFER:APPLICATION_WITHDRAWN",
          },
          {
            code: "PRE_AWARD:REVIEW_OFFER:WITHDRAWAL_REQUESTED",
            source: "CW",
            mappedTo: "PRE_AWARD:REVIEW_OFFER:WITHDRAWAL_REQUESTED",
          },
          {
            code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
            source: "CW",
            mappedTo: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
          },
        ],
      },
      {
        code: "CUSTOMER_AGREEMENT_REVIEW",
        statuses: [
          {
            code: "accepted",
            source: "AS",
            mappedTo: "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
          },
          {
            code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AMENDMENT_REQUESTED",
            source: "CW",
            mappedTo: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AMENDMENT_REQUESTED",
          },
          {
            code: "cancelled",
            source: "AS",
            mappedTo: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:APPLICATION_AMEND",
          },
          {
            code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:WITHDRAWAL_REQUESTED",
            source: "CW",
            mappedTo:
              "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:WITHDRAWAL_REQUESTED",
          },
          {
            code: "withdrawn",
            source: "AS",
            mappedTo:
              "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:APPLICATION_WITHDRAWN",
          },
        ],
      },
    ],
  },
  {
    code: "POST_AGREEMENT_MONITORING",
    stages: [
      {
        code: "MONITORING",
        statuses: [
          {
            code: "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
            source: "CW",
            mappedTo: "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
          },
        ],
      },
    ],
  },
];

export const up = async (db) => {
  await db.collection("grants").updateOne(
    { code: "frps-private-beta" },
    {
      $set: {
        "phases.0.stages.0.statuses": reviewApplicationStatuses,
        "phases.0.stages.1.statuses": reviewOfferStatuses,
        "phases.0.stages.2.statuses": customerAgreementReviewStatuses,
        "phases.1.stages.0.statuses": postAgreementMonitoringStatuses,
        "externalStatusMap.phases": externalMapping,
      },
    },
  );
};
