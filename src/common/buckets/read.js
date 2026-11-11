import { db } from "../mongo-client.js";
import { keyOf, toIso, toStoredTime } from "./bucket.js";
import { encodeCursor } from "./cursor.js";
import { refuse } from "./refusal.js";

export const COUNT_CAP = 10_000;

export const MAX_TIME_MS_EXPIRED = 50;

export const collectionOf = ({ bucket }) => db.collection(bucket.collection);

export const timeLeft = ({ deadline }) => Math.max(1, deadline - Date.now());

export const readOptions = (read) => ({
  hint: keyOf(read.bucket, read.plan.line),
  maxTimeMS: timeLeft(read),
});

const bounds = (bucket, entries) =>
  Object.fromEntries(
    entries
      .filter(([, value]) => value !== undefined)
      .map(([operator, value]) => [operator, toStoredTime(bucket, value)]),
  );

export const rangeOf = ({ bucket, query }) =>
  bounds(bucket, [
    ["$gte", query.from],
    ["$lte", query.to],
  ]);

// A server error may quote the query, and with it a value searched for, so
// only its code is passed on.
const READ_FAILED = "Bucket read failed";

export const withoutValues = ({ code, codeName }) =>
  Object.assign(new Error(READ_FAILED), { code, codeName });

export const refuseTimedOut = (error) => {
  throw error.code === MAX_TIME_MS_EXPIRED
    ? refuse("TIMED_OUT")
    : withoutValues(error);
};

export const positionOf = (bucket, doc) => ({
  t: doc[bucket.time.field],
  i: doc._id,
});

export const toRow = (bucket) => (doc) => ({
  id: String(doc._id),
  time: toIso(doc[bucket.time.field]),
  ...bucket.row.present(doc),
});

export const endOfPage = { next: null, keepLooking: null, searchedTo: null };

export const pageAfter = (bucket, last) => ({
  ...endOfPage,
  next: encodeCursor(positionOf(bucket, last)),
  complete: false,
});

export const cappedAt = (found, cap) => ({
  count: Math.min(found, cap),
  capped: found > cap,
});
