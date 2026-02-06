import { withTransaction } from "../src/common/with-transaction.js";
export const up = async (db) => {
  const fifoLock = db.collection("fifo_locks");
  fifoLock.drop().catch(() => {});
  fifoLock.createIndex({ segregationRef: 1, actor: 1 }, { unique: true });
  fifoLock.createIndex({ locked: 1, segregationRef: 1, lockedAt: 1 });
  fifoLock.createIndex({ locked: 1, segregationRef: 1, actor: 1 });

  db.collection("inbox").createIndex({
    segregationRef: 1,
    status: 1,
    claimedBy: 1,
    completionAttempts: 1,
  });

  await withTransaction(async (session) => {
    await db.collection("inbox").updateMany(
      {},
      [
        {
          $set: {
            segregationRef: {
              $let: {
                vars: {
                  ref: {
                    $ifNull: ["$event.data.caseRef", "$event.data.clientRef"],
                  },
                  code: {
                    $ifNull: [
                      "$event.data.workflowCode",
                      {
                        $ifNull: ["$event.data.code", "$event.data.grantCode"],
                      },
                    ],
                  },
                },
                in: { $concat: ["$$ref", "-", "$$code"] },
              },
            },
          },
        },
      ],
      { session },
    );

    await db.collection("outbox").updateMany(
      {},
      [
        {
          $set: {
            "event.messageGroupId": {
              $let: {
                vars: {
                  ref: {
                    $ifNull: ["$event.data.caseRef", "$event.data.clientRef"],
                  },
                  code: {
                    $ifNull: [
                      "$event.data.workflowCode",
                      {
                        $ifNull: ["$event.data.code", "$event.data.grantCode"],
                      },
                    ],
                  },
                },
                in: { $concat: ["$$ref", "-", "$$code"] },
              },
            },
          },
        },
      ],
      { session },
    );
  });
};
