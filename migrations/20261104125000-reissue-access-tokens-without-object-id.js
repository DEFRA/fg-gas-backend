import { logger } from "../src/common/logger.js";
import { transactionOptions } from "../src/common/with-transaction.js";

// FGP-1572: Grant Admin addresses, names and dates a token by its ObjectId, so
// a row made by hand under any other _id is moved to a new one. The hash is
// unique, so the move is one transaction, which reads the row it moves from
// the primary, as the earlier migrations left it. When it was made is unknown,
// so it is never dated from the new id.
const reissue = async (accessTokens, session, _id) => {
  const row = await accessTokens.findOneAndDelete({ _id }, { session });

  if (row) {
    const { _id: _old, ...fields } = row;
    await accessTokens.insertOne({ createdAt: null, ...fields }, { session });
  }
};

export const up = async (db, client) => {
  const accessTokens = db.collection("access_tokens");
  const rows = await accessTokens
    .find(
      { _id: { $not: { $type: "objectId" } } },
      { projection: { _id: 1 }, readPreference: "primary" },
    )
    .toArray();

  for (const { _id } of rows) {
    const session = client.startSession();

    try {
      await session.withTransaction(
        () => reissue(accessTokens, session, _id),
        transactionOptions,
      );
    } finally {
      await session.endSession();
    }
  }

  logger.info(`Moved ${rows.length} access tokens to an ObjectId`);
};
