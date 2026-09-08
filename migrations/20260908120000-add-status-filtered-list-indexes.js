// The status chip is the most-clicked control on the admin events page, and
// until now it had no index to walk.
//
// `?status=DEAD_LETTER` could only be served two ways: walk the
// `{sortKey,_id}` list index and discard nearly every entry, or take the
// `{status, completionAttempts}` poller index and top-k sort every match.
// Both are near-full scans of a box, on every page turn, on top of the counts
// and breakdown aggregations each render already pays for - and the page is
// most used exactly when a box is at its largest.
//
// `{status, sortKey, _id}` serves the filtered page as a range scan: equality
// on the prefix, then the keyset order for free. The unfiltered page keeps
// using the existing `{sortKey,_id}` index, which this does not replace.
export const up = async (db) => {
  await db
    .collection("inbox")
    .createIndex({ status: 1, eventTime: -1, _id: -1 });
  await db
    .collection("outbox")
    .createIndex({ status: 1, publicationDate: -1, _id: -1 });
};
