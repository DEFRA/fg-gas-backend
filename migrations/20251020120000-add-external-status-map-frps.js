export const up = async (db) => {
  const collection = db.collection("grants");
  const grant = await collection.findOne({ code: "frps-private-beta" });

  if (grant) {
    const externalStatusMap = {
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW",
              statuses: [
                {
                  code: "IN_PROGRESS",
                  source: "CW",
                  mappedTo: "::IN_PROGRESS",
                },
                {
                  code: "APPROVED",
                  source: "CW",
                  mappedTo: "::APPROVED",
                },
                {
                  code: "OFFER_IN_REVIEW",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFER_IN_REVIEW",
                },
                {
                  code: "OFFER_SENT",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFER_SENT",
                },
                {
                  code: "WITHDRAWN",
                  source: "CW",
                  mappedTo: "::OFFER_WITHDRAWN",
                },
                {
                  code: "offered",
                  source: "AS",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFERED",
                },
                {
                  code: "rejected",
                  source: "AS",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFER_REJECTED",
                },
                {
                  code: "withdrawn",
                  source: "AS",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFER_WITHDRAWN",
                },
                {
                  code: "accepted",
                  source: "AS",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFER_ACCEPTED",
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
                  source: "CW",
                  mappedTo: "::ACTIVE",
                },
                {
                  code: "COMPLETED",
                  source: "CW",
                  mappedTo: "::COMPLETED",
                },
              ],
            },
          ],
        },
      ],
    };

    await collection.updateOne(
      { code: "frps-private-beta" },
      { $set: { externalStatusMap } },
    );
  }
};

export const down = async (db) => {
  const collection = db.collection("grants");

  await collection.updateOne(
    { code: "frps-private-beta" },
    { $unset: { externalStatusMap: "" } },
  );
};
