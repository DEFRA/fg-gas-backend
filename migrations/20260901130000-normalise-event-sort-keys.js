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

  console.log(
    `Normalised ${outbox.modifiedCount} outbox publicationDate values to Date`,
  );

  // Any eventTime that is missing, null, or not a string is rebuilt from the
  // CloudEvent's own time when that is a usable string, else from the ObjectId
  // timestamp. `$toString` on a Date yields ISO-8601, matching the model.
  const inbox = await db
    .collection("inbox")
    .updateMany({ eventTime: { $not: { $type: "string" } } }, [
      {
        $set: {
          eventTime: {
            $cond: [
              {
                $and: [
                  { $eq: [{ $type: "$event.time" }, "string"] },
                  { $ne: ["$event.time", ""] },
                ],
              },
              "$event.time",
              { $toString: { $toDate: "$_id" } },
            ],
          },
        },
      },
    ]);

  console.log(
    `Normalised ${inbox.modifiedCount} inbox eventTime values to ISO strings`,
  );
};

// Deliberately a no-op. The migration is lossy in the only direction that
// matters: once a string publicationDate has become a Date we no longer know
// which rows were strings, nor what their original (possibly unparsable) text
// was, and the same is true of a backfilled eventTime. Re-introducing mixed
// types would also re-introduce the pagination fault this migration exists to
// remove, so there is nothing safe to undo.
export const down = async () => {
  console.log(
    "20260901130000-normalise-event-sort-keys: down is a no-op - sort-key types cannot be un-normalised meaningfully",
  );
};
