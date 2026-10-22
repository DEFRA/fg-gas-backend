import { configVersionUpdated } from "../src/grants/events/inbound-event-types.js";
import { logger } from "../src/common/logger.js";
import { backfillInboxStamps } from "../src/events/stamps.js";

// Stamps the stored config version events with their grant code as a
// reference, and with their code and version as a link, read from the envelope
// as their writer saw it. It writes only the refs a row lacks, so running it
// again changes nothing.
const BATCH_SIZE = 1000;

const primary = { readPreference: "primary" };

const projection = {
  segregationRef: 1,
  traceparent: 1,
  event: 1,
  originalPayload: 1,
  refs: 1,
};

// The rows there were when this started. The version it replaces may still be
// writing while both run, and those rows are not this migration's to check.
const newestId = async (inbox) => {
  const [newest] = await inbox
    .find({}, { ...primary, projection: { _id: 1 }, sort: { _id: -1 } })
    .limit(1)
    .toArray();

  return newest?._id ?? null;
};

const isConfigLink = (ref) => ref.startsWith("config:");

const missingRefsOf = (doc, refs) =>
  refs.filter((ref) => !doc.refs.includes(ref));

// A row whose refs are not an array was never stamped: it is counted, not
// linked. A row with no grant code or no version has no link, but keeps its
// other refs.
const stampable = (newest) => ({
  eventType: configVersionUpdated.name,
  _id: { $lte: newest },
  refs: { $type: "array" },
});

const unstamped = (newest) => ({
  eventType: configVersionUpdated.name,
  _id: { $lte: newest },
  refs: { $not: { $type: "array" } },
});

async function* stampsOf(inbox, newest) {
  const rows = inbox.find(stampable(newest), {
    ...primary,
    projection,
    sort: { _id: 1 },
    batchSize: BATCH_SIZE,
  });

  for await (const doc of rows) {
    const { refs } = backfillInboxStamps(doc);

    yield {
      _id: doc._id,
      missing: missingRefsOf(doc, refs),
      linked: refs.some(isConfigLink),
    };
  }
}

const isStale = ({ missing }) => missing.length > 0;

const toWrite = ({ _id, missing }) => ({
  updateOne: {
    filter: { _id },
    update: { $addToSet: { refs: { $each: missing } } },
  },
});

const stamp = async (inbox, newest) => {
  let stamped = 0;
  let unlinked = 0;
  let writes = [];

  for await (const row of stampsOf(inbox, newest)) {
    if (!row.linked) {
      unlinked += 1;
    }

    if (isStale(row)) {
      writes.push(toWrite(row));
    }

    if (writes.length === BATCH_SIZE) {
      await inbox.bulkWrite(writes, { ordered: false });
      stamped += writes.length;
      writes = [];
    }
  }

  if (writes.length > 0) {
    await inbox.bulkWrite(writes, { ordered: false });
  }

  return { stamped: stamped + writes.length, unlinked };
};

const assertStamped = async (inbox, newest) => {
  let count = 0;

  for await (const row of stampsOf(inbox, newest)) {
    if (isStale(row)) {
      count += 1;
    }
  }

  if (count > 0) {
    throw new Error(
      `${count} ConfigVersionUpdated inbox rows were left without their refs`,
    );
  }
};

export const up = async (db) => {
  const inbox = db.collection("inbox");
  const newest = await newestId(inbox);

  if (newest === null) {
    return;
  }

  const { stamped, unlinked } = await stamp(inbox, newest);
  const never = await inbox.countDocuments(unstamped(newest), primary);

  logger.info(`Stamped ${stamped} ConfigVersionUpdated rows`);
  logger.info(
    `${unlinked} ConfigVersionUpdated rows lack a grant code or a version, so have no version link`,
  );
  if (never > 0) {
    logger.warn(
      `${never} ConfigVersionUpdated rows were never stamped, so are left as stored`,
    );
  }

  await assertStamped(inbox, newest);
};
