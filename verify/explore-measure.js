#!/usr/bin/env node
/**
 * Measures what Explore's answers and documents weigh on a database, to set
 * the allowances in src/common/explore/query-schema.js and the readers'
 * maxBytes: each collection's stored document sizes ($bsonSize, sampled),
 * and the JSON a row of its default Table takes, the largest 5,000-row
 * Table and CSV answer that makes, and what a row takes beside its cells.
 * It prints counts and sizes only, never a stored value.
 *
 * Usage: MONGO_URI=mongodb://localhost:27017 node verify/explore-measure.js
 */

import { MongoClient } from "mongodb";
import { MAX_LIMIT } from "../src/common/explore/query-schema.js";
import { rowMaker, withCells } from "../src/common/explore/rows.js";
import { readersFor } from "../src/common/explore/fields.js";

const SAMPLE = 10_000;
const MAX_TIME_MS = 20_000;

// Each source's collection, its default columns and what a row opens, as
// the sources declare them.
const TARGETS = [
  {
    db: "fg-gas-backend",
    collection: "applications",
    time: "createdAt",
    star: ["clientRef", "code", "currentStatus", "createdAt"],
    open: (doc) => ({
      kind: "application",
      code: doc.code,
      ref: doc.clientRef,
    }),
  },
  {
    db: "fg-cw-backend",
    collection: "cases",
    time: "createdAt",
    star: ["caseRef", "workflowCode", "currentStatus", "createdAt"],
    open: (doc) => ({ kind: "case", code: doc.workflowCode, ref: doc.caseRef }),
  },
  ...["fg-gas-backend", "fg-cw-backend"].flatMap((db) =>
    ["outbox", "inbox"].map((collection) => ({
      db,
      collection,
      time: "publicationDate",
      star: ["publicationDate", "eventType", "status"],
      open: (doc, box) => ({
        kind: "event",
        service: box.service,
        box: box.box,
        id: String(doc._id),
      }),
    })),
  ),
];

const percentile = (sorted, p) =>
  sorted[
    Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))
  ];

const bytesOf = (value) => Buffer.byteLength(JSON.stringify(value));

const sizesOf = async (collection) =>
  (
    await collection
      .aggregate(
        [
          { $sample: { size: SAMPLE } },
          { $project: { _id: 0, s: { $bsonSize: "$$ROOT" } } },
        ],
        { maxTimeMS: MAX_TIME_MS, allowDiskUse: false },
      )
      .toArray()
  )
    .map(({ s }) => s)
    .sort((a, b) => a - b);

const tableRowsOf = async (collection, target) => {
  const query = {
    columns: target.star.map((path) => ({ path })),
    orderBy: null,
  };
  const make = rowMaker({
    query,
    readerOf: readersFor({}).readerOf,
    open: target.open,
    timeNames: [target.time],
  });
  const box = {
    service: target.db.includes("cw") ? "CW" : "GAS",
    box: target.collection,
  };
  const docs = await collection
    .aggregate([{ $sample: { size: MAX_LIMIT } }], {
      maxTimeMS: MAX_TIME_MS,
      allowDiskUse: false,
      promoteValues: false,
    })
    .toArray();

  return docs.map((doc) => withCells(make(doc, box)));
};

const besideCells = ({ cells, ...row }) => bytesOf(row);

const measure = async (client, target) => {
  const collection = client.db(target.db).collection(target.collection);
  const sizes = await sizesOf(collection);
  const rows = await tableRowsOf(collection, target);
  const rowBytes = rows.map(bytesOf).sort((a, b) => a - b);
  const beside = rows.map(besideCells).sort((a, b) => a - b);

  return {
    source: `${target.db}.${target.collection}`,
    sampled: sizes.length,
    documentBytes: {
      p50: percentile(sizes, 0.5),
      p99: percentile(sizes, 0.99),
      max: sizes.at(-1),
    },
    tableRowBytes: { p50: percentile(rowBytes, 0.5), max: rowBytes.at(-1) },
    rowBytesBesideCells: { max: beside.at(-1) },
    largestTableAnswer: rowBytes.at(-1) * MAX_LIMIT,
    sampledTableAnswer: rowBytes.reduce((sum, n) => sum + n, 0),
  };
};

const client = new MongoClient(process.env.MONGO_URI, {
  readPreference: "secondaryPreferred",
});

try {
  await client.connect();

  for (const target of TARGETS) {
    process.stdout.write(`${JSON.stringify(await measure(client, target))}\n`);
  }
} finally {
  await client.close();
}
