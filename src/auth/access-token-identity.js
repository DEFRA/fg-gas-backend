import { db } from "../common/mongo-client.js";
import { logger } from "../common/logger.js";
import { CLIENT_NAME } from "./models/access-token.js";

// Counts access tokens Grant Admin cannot manage or that auth reads oddly, so
// the logs show when stored data needs attention. Counts only: never tokens,
// hashes or names.

const primary = { readPreference: "primary" };

// Grant Admin manages a token only under a name that passes the name rule.
const hasClientName = {
  $cond: [
    { $eq: [{ $type: "$clientId" }, "string"] },
    { $regexMatch: { input: "$clientId", regex: CLIENT_NAME } },
    false,
  ],
};

// Auth compares expiresAt with `>=`, so one that is not a date reads oddly.
// Aggregation's $type, which unlike the query operator never matches an array
// by its elements.
const nonDateExpiry = {
  $not: [{ $in: [{ $type: "$expiresAt" }, ["missing", "null", "date"]] }],
};

const count = (accessTokens, expr) =>
  accessTokens.countDocuments({ $expr: expr }, primary);

export const countIdentityShapes = async (accessTokens) => {
  const [named, unnamed, nonDateExpiries] = await Promise.all([
    count(accessTokens, hasClientName),
    count(accessTokens, { $not: [hasClientName] }),
    count(accessTokens, nonDateExpiry),
  ]);

  return { named, unnamed, nonDateExpiries };
};

// Runs on every boot so records written by older versions keep showing up
// until they are resolved. Never fails startup.
export const reportAccessTokenIdentity = async () => {
  try {
    const counts = await countIdentityShapes(db.collection("access_tokens"));

    const message =
      `Access token identity: ${counts.named} named, ` +
      `${counts.unnamed} without a valid client name, ` +
      `${counts.nonDateExpiries} with an expiresAt that is not a date`;

    if (counts.unnamed === 0 && counts.nonDateExpiries === 0) {
      logger.info(message);
    } else {
      logger.warn(message);
    }
  } catch (error) {
    logger.error(
      { code: error.code },
      `Failed to report access token identity: ${error.message}`,
    );
  }
};
