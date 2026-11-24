const index = {
  segregationRef: 1,
  applicationReportingSequence: 1,
  publicationDate: 1,
  _id: 1,
};

export const up = async (db) => {
  await db.collection("outbox").createIndex(index, {
    partialFilterExpression: {
      "event.eventData.eventType": {
        $in: ["APPLICATION_CREATED", "APPLICATION_STATUS_CHANGED"],
      },
    },
  });
};

export const down = async (db) => {
  await db.collection("outbox").dropIndex(index);
};
