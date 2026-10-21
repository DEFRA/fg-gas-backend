import { logger } from "../src/common/logger.js";
import {
  applicationRefs,
  seriesRefs,
} from "../src/grants/models/application-document.js";

// Gives every application the refs its writers now keep.
// Every write is an `$addToSet` or a `$set` of the same value, so it is safe to
// run over a row a writer has already stamped.

const BATCH_SIZE = 1000;

const primary = { readPreference: "primary" };

const toOwnRefsWrite = (doc) => ({
  updateOne: {
    filter: { _id: doc._id },
    update: { $addToSet: { refs: { $each: applicationRefs(doc) } } },
  },
});

const stampOwnRefs = async (applications) => {
  const all = applications.find(
    {},
    {
      ...primary,
      projection: { clientRef: 1, identifiers: 1, agreements: 1 },
      sort: { _id: 1 },
      batchSize: BATCH_SIZE,
    },
  );
  let stamped = 0;
  let writes = [];

  for await (const doc of all) {
    writes.push(toOwnRefsWrite(doc));

    if (writes.length === BATCH_SIZE) {
      await applications.bulkWrite(writes, { ordered: false });
      stamped += writes.length;
      writes = [];
    }
  }

  if (writes.length > 0) {
    await applications.bulkWrite(writes, { ordered: false });
  }

  return stamped + writes.length;
};

const linkSeries = (applications, { code, clientRefs }) =>
  applications.updateMany(
    { code, clientRef: { $in: clientRefs } },
    { $addToSet: { refs: { $each: seriesRefs(clientRefs) } } },
  );

const linkEverySeries = async (db, applications) => {
  const replacements = db
    .collection("application_series")
    .find({ "clientRefs.1": { $exists: true } }, primary);
  let linked = 0;

  for await (const series of replacements) {
    await linkSeries(applications, series);
    linked += 1;
  }

  return linked;
};

const assertNone = async (applications, filter, problem) => {
  const count = await applications.countDocuments(filter, primary);

  if (count > 0) {
    throw new Error(`${count} applications ${problem}`);
  }
};

export const up = async (db) => {
  const applications = db.collection("applications");

  const stamped = await stampOwnRefs(applications);
  const linked = await linkEverySeries(db, applications);

  logger.info(
    `Gave ${stamped} applications their refs and linked ${linked} series`,
  );

  await assertNone(applications, { refs: null }, "were left without refs");
};
