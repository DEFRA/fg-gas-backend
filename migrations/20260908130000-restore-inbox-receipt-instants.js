// Migrations run in-process at deployment, so anything written here lands in
// the same pino stream CDP ingests - `console.log` would put a raw,
// unstructured line in the middle of it.
import { logger } from "../src/common/logger.js";

// Repairs the inbox receipts that a since-fixed model defect overwrote.
//
// `publicationDate` on an inbox row means "when this service received the
// message". The model used to stamp it `now` in its constructor, and
// `fromDocument` runs that constructor - so every claim-process cycle rewrote
// it, and the field ended up meaning "when this row was last written". The
// evidence was on every completed row in the dev store: `publicationDate` sat
// a handful of milliseconds BEFORE `completionDate`, and hundreds of
// milliseconds after the CloudEvent's own `time`. That is the shape of a
// write, not of a receipt.
//
// The model keeps its stored value now, so new rows are right. This puts the
// old ones back.
//
// WHAT IT RESTORES: the ObjectId's own timestamp, which is when the document
// was INSERTED. That is a proxy for the receipt, not the instant itself - the
// two are the same write in this codebase, but the id carries only
// second-precision. An approximate receipt is worth far more than a
// confidently wrong one: the rows worst affected are dead letters retried over
// days, whose "receipt" currently reads as their last failed attempt.
//
// WHAT IT LEAVES ALONE: everything it cannot prove is wrong. A receipt may
// legitimately trail the insert by milliseconds, so only rows whose stored
// value is MORE THAN A MINUTE LATER than the insert are touched - a gap no
// honest receipt has. Rows written since the model fix, rows never re-saved,
// and rows whose stored value is unreadable are all left as they are.
//
// Idempotent by construction: a repaired row's `publicationDate` equals its
// own insert instant, so the filter cannot match it again.

// A receipt can trail its insert by milliseconds; nothing honest trails it by
// a minute.
const DRIFT_MS = 60_000;

// Both stored forms are read: the model writes an ISO string, and a row
// written by an older path may hold a BSON Date.
const storedInstant = {
  $convert: {
    input: "$publicationDate",
    to: "date",
    onError: null,
    onNull: null,
  },
};

const insertedAt = { $toDate: "$_id" };

// Only the rows this can prove wrong: readable, and later than their own
// insert by more than a receipt ever is.
const rewrittenRows = {
  $expr: {
    $gt: [{ $subtract: [storedInstant, insertedAt] }, DRIFT_MS],
  },
};

export const up = async (db) => {
  const result = await db
    .collection("inbox")
    .updateMany(rewrittenRows, [
      { $set: { publicationDate: { $toString: insertedAt } } },
    ]);

  logger.info(
    `Restored ${result.modifiedCount} inbox receipt instants from their insert time`,
  );
};
