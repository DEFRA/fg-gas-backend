import { ObjectId } from "mongodb";
import { AccessToken, LAST_EXPIRY } from "../src/auth/models/access-token.js";
import { logger } from "../src/common/logger.js";

// FGP-1572: Grant Admin lists a token's dates as stored, and accepts only a
// date from 1970 to 9999, or null. Any other value is normalised, keeping the
// access the token gives now. Auth reads an expiry that is not a date as a
// number, so one that reads as a number in that range, a numeric string among
// them, becomes that date; any other becomes never while the token still
// calls, and now when it can't (zero is falsy, so it has never expired). A
// truthy revokedAt revokes, so it becomes now; a falsy one never did, so it
// becomes null. A createdAt becomes the time its ObjectId was made, or
// unknown. Runs before the reissue, which gives a row a new ObjectId.
const EPOCH = new Date(0);
const DATES = ["expiresAt", "revokedAt", "createdAt"];

// Aggregation's $type, which unlike the query operator never matches an array
// by its elements.
const isUnlisted = (field) => ({
  $and: [
    { $not: [{ $in: [{ $type: `$${field}` }, ["missing", "null"]] }] },
    {
      $not: [
        {
          $and: [
            { $eq: [{ $type: `$${field}` }, "date"] },
            { $gte: [`$${field}`, EPOCH] },
            { $lte: [`$${field}`, LAST_EXPIRY] },
          ],
        },
      ],
    },
  ],
});

const isListed = (value) =>
  value == null ||
  (value instanceof Date && value >= EPOCH && value <= LAST_EXPIRY);

// Auth compares now with a truthy expiry that is not a date as Number(it). True
// reads as 1 ms past 1970, which says only that it has expired.
const epochMsOf = (expiresAt) =>
  expiresAt && typeof expiresAt !== "boolean" ? Number(expiresAt) : NaN;

const expiryOf = (row, now) => {
  const ms = epochMsOf(row.expiresAt);

  if (ms > 0 && ms <= LAST_EXPIRY.getTime()) {
    return new Date(ms);
  }

  return AccessToken.fromDocument(row).isActive(now) ? null : now;
};

const normalisers = {
  expiresAt: expiryOf,
  revokedAt: ({ revokedAt }, now) => (revokedAt ? now : null),
  createdAt: ({ _id }) => (_id instanceof ObjectId ? _id.getTimestamp() : null),
};

const normalise = (row, now) => {
  const fields = DATES.filter((field) => !isListed(row[field]));

  return {
    updateOne: {
      filter: { _id: row._id, $expr: { $and: fields.map(isUnlisted) } },
      update: {
        $set: Object.fromEntries(
          fields.map((field) => [field, normalisers[field](row, now)]),
        ),
      },
    },
  };
};

export const up = async (db) => {
  const accessTokens = db.collection("access_tokens");
  const now = new Date();
  const rows = await accessTokens
    .find(
      { $expr: { $or: DATES.map(isUnlisted) } },
      { projection: { _id: 1, expiresAt: 1, revokedAt: 1, createdAt: 1 } },
    )
    .toArray();
  let normalised = 0;

  if (rows.length > 0) {
    ({ modifiedCount: normalised } = await accessTokens.bulkWrite(
      rows.map((row) => normalise(row, now)),
    ));
  }

  logger.info(`Normalised the dates of ${normalised} access tokens`);
};
