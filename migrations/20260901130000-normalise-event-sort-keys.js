// Normalises the two event sort keys - outbox.publicationDate and
// inbox.eventTime - to one BSON type each, so sorting and range queries over
// them behave chronologically.
//
// Why this is needed: MongoDB's canonical type order is
// Null < Number < String < Object < ... < Date, and both sorting and
// comparison operators are type-bracketed. In a collection holding *both* a
// String and a Date in the sort field, `sort({ publicationDate: 1 })` orders
// by type first - so the outbox poller (which claims events oldest-first by
// publicationDate) processes every Date row before any string row regardless
// of their actual times, and `{ publicationDate: { $lt: <Date> } }` never
// matches a string row at all, which silently strands rows from any keyset
// walk over the collection. The same applies to `inbox.eventTime` (the inbox
// poller's sort key) when null/missing rows sit behind string-valued ones.
//
// Canonical types after this migration:
//   outbox.publicationDate -> BSON Date   (models/outbox.js writes a Date)
//   inbox.eventTime        -> ISO string  (models/inbox.js writes event.time)
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
