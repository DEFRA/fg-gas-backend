export const up = async (db) => {
  const accessTokens = db.collection("access_tokens");
  accessTokens.drop().catch(() => {});
  accessTokens.createIndex({ id: 1 }, { unique: true });
  accessTokens.createIndex({ client: 1 });
  accessTokens.createIndex({ expiresAt: 1 });

  const grants = db.collection("grants");
  await grants.drop().catch(() => {});
  await grants.createIndex({ code: 1 }, { unique: true });

  const applications = db.collection("applications");
  await applications.drop().catch(() => {});
  await applications.createIndex({ clientRef: 1, code: 1 }, { unique: true });

  const outbox = db.collection("outbox");
  await outbox.drop().catch(() => {});
  await outbox.createIndex({
    status: 1,
    claimedBy: 1,
    completionAttempts: 1,
    publicationDate: 1,
  });
  await outbox.createIndex({ claimExpiresAt: 1 });
  await outbox.createIndex({ status: 1, completionAttempts: 1 });

  const inbox = db.collection("inbox");
  await inbox.drop().catch(() => {});
  await inbox.createIndex({
    status: 1,
    claimedBy: 1,
    completionAttempts: 1,
    publicationDate: 1,
  });
  await inbox.createIndex({ claimExpiresAt: 1 });
  await inbox.createIndex({ messageId: 1 });
  await inbox.createIndex({ status: 1, completionAttempts: 1 });
};
