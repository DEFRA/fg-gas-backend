import { setTimeout } from "node:timers/promises";
import { logger } from "../logger.js";
import { db } from "../mongo-client.js";
import { withTransaction } from "../with-transaction.js";
import { addLeftOut } from "./keys.js";
import { sweepRecords, warnLeftOut } from "./store.js";

export const SWEEPS = "search_sweeps";

const NEW_PASS = {
  after: null,
  passStartedAt: null,
  lastPassCompletedAt: null,
  checked: 0,
  fixed: 0,
};

// `after` is the last record a pass has swept, null before its first batch.
// The pass's counts are kept with it, so another instance can carry it on.
export const nextSweep = (state, { checked, fixed, last }, now) => {
  const current = { ...NEW_PASS, ...state };
  const counts = {
    checked: current.checked + checked,
    fixed: current.fixed + fixed,
  };

  if (last === null) {
    return {
      state: { ...NEW_PASS, lastPassCompletedAt: now },
      completed: counts,
    };
  }

  return {
    state: {
      ...current,
      ...counts,
      after: last,
      passStartedAt: current.passStartedAt ?? now,
    },
    completed: null,
  };
};

// Claims the sweep's next batch, answering its position, or null when it is
// not due. It is the transaction's first write, so a second instance
// conflicts before it reads any records, then finds the batch taken. None is
// due within `intervalMs` of the last batch, whichever instance swept it, so
// the cluster sweeps one batch an interval however many instances run.
const claimBatch = (collection, intervalMs, now, session) =>
  db.collection(SWEEPS).findOneAndUpdate(
    {
      _id: collection,
      lastBatchAt: { $not: { $gt: new Date(now - intervalMs) } },
    },
    { $set: { lastBatchAt: now } },
    { projection: { _id: 0 }, returnDocument: "after", session },
  );

const ensureSweep = (collection) =>
  db
    .collection(SWEEPS)
    .updateOne(
      { _id: collection },
      { $setOnInsert: NEW_PASS },
      { upsert: true },
    );

// The safety net under the write path and the reindexer: it walks every record
// in turn, a batch per wake, and fixes whatever search document has drifted.
// A batch reads its records, their documents and the sweep's position in the
// transaction that writes them, so a record written meanwhile conflicts and
// the batch is retried.
export class SearchSweeper {
  constructor({ source, batchSize, intervalMs }) {
    this.source = source;
    this.batchSize = batchSize;
    this.intervalMs = intervalMs;
    this.running = false;
  }

  async sweepFrom(state, declarations, now, session) {
    const swept = await sweepRecords(
      this.source,
      declarations,
      { after: state.after, limit: this.batchSize },
      session,
    );
    const next = nextSweep(
      state,
      {
        checked: swept.checked,
        fixed: swept.changed.length + swept.removed,
        last: swept.last,
      },
      now,
    );

    await db
      .collection(SWEEPS)
      .replaceOne(
        { _id: this.source.collection },
        { ...next.state, lastBatchAt: now },
        { session },
      );

    return { changed: swept.changed, completed: next.completed };
  }

  async sweepBatch() {
    const { collection } = this.source;
    const declarations = await this.source.declarations.current();

    await ensureSweep(collection);

    const { changed, completed } = await withTransaction(async (session) => {
      const now = new Date();
      const state = await claimBatch(collection, this.intervalMs, now, session);

      return state
        ? this.sweepFrom(state, declarations, now, session)
        : { changed: [], completed: null };
    });

    const leaving = changed.filter((doc) => Object.keys(doc.left).length > 0);

    warnLeftOut(
      this.source,
      leaving.reduce((sum, doc) => addLeftOut(sum, doc.left), {}),
      leaving.length,
    );

    if (completed) {
      const log = completed.fixed > 0 ? logger.warn : logger.info;

      log.call(
        logger,
        `Search ${collection}: swept ${completed.checked} records, fixed ${completed.fixed} documents`,
      );
    }
  }

  async poll() {
    while (this.running) {
      try {
        await this.sweepBatch();
      } catch (error) {
        logger.error(error, `Error sweeping ${this.source.collection}`);
      }

      await setTimeout(this.intervalMs, undefined, { ref: false });
    }
  }

  start() {
    logger.info(`Starting search sweeper for ${this.source.collection}`);
    this.running = true;
    this.poll().catch((error) => {
      logger.error(error, "Search sweeper stopped");
    });
  }

  stop() {
    logger.info(`Stopping search sweeper for ${this.source.collection}`);
    this.running = false;
  }
}
