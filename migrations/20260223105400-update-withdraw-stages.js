export const up = async (db) => {
  const query = { code: "frps-private-beta" };

  const stages = [
    {
      code: "REVIEW_APPLICATION",
      name: "Review Application",
      description: "Review the application for eligibility",
      statuses: [
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
          code: "WITHDRAWAL_REQUESTED",
          validFrom: [
            {
              code: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
              processes: ["UPDATE_AGREEMENT_CASE"],
            },
            {
              code: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
              processes: ["UPDATE_AGREEMENT_CASE"],
            },
          ],
        },
        {
          code: "APPLICATION_WITHDRAWN",
          validFrom: [
            {
              code: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
              processes: ["UPDATE_AGREEMENT_CASE"],
            },
          ],
        },
      ],
    },
    {
      code: "REVIEW_OFFER",
      name: "Review Offer",
      description: "Review the offer made to the applicant",
      statuses: [
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
              processes: ["UPDATE_AGREEMENT_CASE"],
            },
          ],
        },
        {
          code: "APPLICATION_WITHDRAWN",
          validFrom: [
            {
              code: "PRE_AWARD:REVIEW_OFFER:WITHDRAWAL_REQUESTED",
              processes: ["UPDATE_AGREEMENT_CASE"],
            },
          ],
        },
      ],
    },
    {
      code: "CUSTOMER_AGREEMENT_REVIEW",
      name: "Customer Agreement Review",
      description: "Customer reviews the agreement offer",
      statuses: [
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
          code: "WITHDRAWAL_REQUESTED",
          validFrom: [
            {
              code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
              processes: ["UPDATE_AGREEMENT_CASE"],
            },
          ],
        },
        {
          code: "APPLICATION_WITHDRAWN",
          validFrom: [
            {
              code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:WITHDRAWAL_REQUESTED",
              processes: ["UPDATE_AGREEMENT_CASE"],
            },
          ],
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
              code: "PRE_AWARD:REVIEW_OFFER:APPLICATION_REJECTED",
              source: "CW",
              mappedTo: "PRE_AWARD:REVIEW_OFFER:APPLICATION_REJECTED",
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
          ],
        },
        {
          code: "CUSTOMER_AGREEMENT_REVIEW",
          statuses: [
            {
              code: "accepted",
              source: "AS",
              mappedTo:
                "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
            },
            {
              code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
              source: "CW",
              mappedTo: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
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
              mappedTo:
                "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
            },
          ],
        },
      ],
    },
  ];

  await db.collection("grants").updateOne(query, {
    $set: {
      "phases.0.stages": stages,
      "externalStatusMap.phases": externalMapping,
    },
  });
};
