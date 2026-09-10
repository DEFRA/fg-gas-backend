// Migrations run in-process at deployment, so anything written here lands in
// the same pino stream CDP ingests - `console.log` would put a raw,
// unstructured line in the middle of it.
import { logger } from "../src/common/logger.js";

// Normalises the two event-list sort keys so keyset pagination cannot silently
// strand rows.
//
// Why this is needed: MongoDB's canonical type order is
// Null < Number < String < Object < ... < Date, and comparison operators are
// type-bracketed. So in a collection holding *both* a String and a Date in the
// sort field, `{ publicationDate: { $lt: <Date> } }` never matches a string
// row. A keyset walk therefore stops at the end of the Date block and the
// string rows become unreachable - not merely mis-ordered, but invisible. The
// same applies to `inbox.eventTime` when null/missing rows sit behind
// string-valued ones. See tickets/FGP-1392 Plan 01, Risks 1 and 2.
//
// Canonical types after this migration:
//   outbox.publicationDate -> BSON Date   (models/outbox.js:37 writes a Date)
//   inbox.eventTime        -> ISO string  (models/inbox.js:38 writes event.time)
//
// Ordering: this runs *after* 20260901120000-add-event-list-indexes.js. Index
// creation over mixed types is harmless - an index stores whatever types are
// present - so there is no need to normalise first. What matters is that both
// have run before anything *reads* through the index, and migrate-mongo applies
// them in timestamp order within the same boot, before the server starts
// (src/grants/index.js -> src/main.js).
//
// Both passes are driven by a single server-side `updateMany` with an
// aggregation pipeline, so each collection is one pass with no documents pulled
// into the application. The unparsable-string fallback is expressed with
// `$dateFromString`'s `onError`/`onNull`, which is exactly the escape hatch this
// needs - no cursor loop is required.
//
// Idempotent: each pass selects only documents that are still the wrong type, so
// a second run matches nothing and modifies nothing.

export const up = async (db) => {
  // Any string publicationDate becomes a real Date. A string Mongo cannot parse
  // falls back to the document's own ObjectId timestamp, so no string survives.
  const outbox = await db
    .collection("outbox")
    .updateMany({ publicationDate: { $type: "string" } }, [
      {
        $set: {
          publicationDate: {
            $dateFromString: {
              dateString: "$publicationDate",
              onError: { $toDate: "$_id" },
              onNull: { $toDate: "$_id" },
            },
          },
        },
      },
    ]);

  logger.info(
    `Normalised ${outbox.modifiedCount} outbox publicationDate values to Date`,
  );

  // EVERY eventTime is rewritten, not only the missing and non-string ones.
  //
  // The keyset compares this value as a string, the range bounds are string
  // bounds, and the merge orders by `Date.parse` of it - so a stored
  // `2026-06-16T11:00:00+01:00` or a date-only `2026-06-16` is as broken as a
  // missing one: it sorts lexically where it does not belong chronologically,
  // and the merge's parsed order stops agreeing with the source's own keyset
  // order. Passing it through `$dateFromString` -> `$toString` canonicalises
  // it to the Z-normalised, millisecond form the model now writes.
  //
  // Idempotent: a value already in that form parses to itself. Anything
  // unparsable, absent or of the wrong type falls back to the CloudEvent's own
  // time and then to the ObjectId's timestamp, which is the closest thing to a
  // receipt a row that never recorded one has.
  const inbox = await db.collection("inbox").updateMany({}, [
    {
      $set: {
        eventTime: {
          $toString: {
            $dateFromString: {
              dateString: { $toString: "$eventTime" },
              onError: {
                $dateFromString: {
                  dateString: { $toString: "$event.time" },
                  onError: { $toDate: "$_id" },
                  onNull: { $toDate: "$_id" },
                },
              },
              onNull: {
                $dateFromString: {
                  dateString: { $toString: "$event.time" },
                  onError: { $toDate: "$_id" },
                  onNull: { $toDate: "$_id" },
                },
              },
            },
          },
        },
      },
    },
  ]);

  logger.info(
    `Normalised ${inbox.modifiedCount} inbox eventTime values to ISO strings`,
  );
};
