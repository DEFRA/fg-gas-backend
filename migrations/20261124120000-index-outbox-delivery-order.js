const index = {
  segregationRef: 1,
  deliverySequence: 1,
  publicationDate: 1,
  _id: 1,
};

export const up = async (db) => {
  await db.collection("outbox").createIndex(index, {
    partialFilterExpression: {
      status: {
        $in: [
          "PUBLISHED",
          "PROCESSING",
          "FAILED",
          "RESUBMITTED",
          "DEAD_LETTER",
        ],
      },
      deliverySequence: { $exists: true },
    },
  });
};

export const down = async (db) => {
  await db.collection("outbox").dropIndex(index);
};
