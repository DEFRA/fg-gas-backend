import { setTimeout } from "node:timers/promises";
import { logger } from "../logger.js";
import { withTransaction } from "../with-transaction.js";
import { addLeftOut } from "./keys.js";
import { findStaleIds, rebuildSearchDocuments, warnLeftOut } from "./store.js";

export const BATCH_SIZE = 200;
export const MAX_BATCHES_PER_WAKE = 10;
export const BATCH_PAUSE_MS = 250;

const isSame = (declaration, now) =>
  now !== undefined &&
  now.sig === declaration.sig &&
  now.stamp === declaration.stamp;

// Rebuilds the search documents a declaration change left behind: those whose
// `sig` is not their lead value's current one, never one built from a later
// declaration. A batch reads its records in the transaction that writes their
// documents, so a record written meanwhile conflicts and the batch is retried
// rather than storing an older value. A wake rebuilds a bounded number of
// batches, pausing between them, and reads the declarations afresh before
// each: one that changed ends the wake, so the next starts from it.
export class SearchReindexer {
  constructor({ source, intervalMs }) {
    this.source = source;
    this.intervalMs = intervalMs;
    this.running = false;
  }

  async isStillDeclared(value, declaration) {
    await setTimeout(BATCH_PAUSE_MS, undefined, { ref: false });

    const now = await this.source.declarations.current({ fresh: true });

    return isSame(declaration, now.get(value));
  }

  isDone(wake) {
    return !this.running || wake.batches >= MAX_BATCHES_PER_WAKE;
  }

  // None once the wake has done its batches, or its declaration changed.
  async staleIds(value, declaration, wake) {
    if (this.isDone(wake)) {
      return [];
    }

    if (wake.batches > 0 && !(await this.isStillDeclared(value, declaration))) {
      wake.changed = true;

      return [];
    }

    return findStaleIds(this.source, value, declaration, BATCH_SIZE);
  }

  async rebuild(ids, declaration, tally) {
    const { built, rebuilt, removed } = await withTransaction((session) =>
      rebuildSearchDocuments(this.source, ids, declaration, session),
    );
    const leaving = built.filter((doc) => Object.keys(doc.left).length > 0);

    tally.rebuilt += rebuilt;
    tally.removed += removed;
    tally.leftOn += leaving.length;
    tally.left = leaving.reduce(
      (sum, doc) => addLeftOut(sum, doc.left),
      tally.left,
    );
  }

  async reindexValue(value, declaration, wake) {
    const tally = { rebuilt: 0, removed: 0, leftOn: 0, left: {} };
    let ids = await this.staleIds(value, declaration, wake);

    while (ids.length > 0) {
      await this.rebuild(ids, declaration, tally);
      wake.batches += 1;
      ids = await this.staleIds(value, declaration, wake);
    }

    this.logTally(value, tally);
  }

  logTally(value, { rebuilt, removed, leftOn, left }) {
    if (rebuilt + removed > 0) {
      logger.info(
        `Search ${this.source.collection}: rebuilt ${rebuilt} and removed ${removed} documents of ${value}`,
      );
      warnLeftOut(this.source, left, leftOn);
    }
  }

  async reindex() {
    const declarations = await this.source.declarations.current({
      fresh: true,
    });
    const wake = { batches: 0, changed: false };

    for (const [value, declaration] of declarations) {
      await this.reindexValue(value, declaration, wake);

      if (wake.changed || this.isDone(wake)) {
        return;
      }
    }
  }

  async poll() {
    while (this.running) {
      try {
        await this.reindex();
      } catch (error) {
        logger.error(error, `Error reindexing ${this.source.collection}`);
      }

      await setTimeout(this.intervalMs, undefined, { ref: false });
    }
  }

  start() {
    logger.info(`Starting search reindexer for ${this.source.collection}`);
    this.running = true;
    this.poll().catch((error) => {
      logger.error(error, "Search reindexer stopped");
    });
  }

  stop() {
    logger.info(`Stopping search reindexer for ${this.source.collection}`);
    this.running = false;
  }
}
