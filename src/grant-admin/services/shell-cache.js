import { beforeDeadline } from "../../common/before-deadline.js";
import {
  describeBucket,
  describeBucketWith,
  unreadValues,
} from "../../common/buckets/catalogue.js";
import { config } from "../../common/config.js";
import { listBuckets } from "../../common/buckets/registry.js";
import { logger } from "../../common/logger.js";
import { findCwBuckets } from "../repositories/cw-actuators.repository.js";
import { describeError } from "../repositories/cw-http.js";

// The catalogue is kept whole on each instance: a good one for
// ADMIN_SHELL_CACHE_MS, one missing a part for FAILED_MS. A kept one is
// answered at once and read again behind it; only a cold instance waits, and
// requests that arrive during a read share it.
export const FAILED_MS = 10_000;
export const CW_TIMEOUT_MS = 1_000;

const CW_UNAVAILABLE = { buckets: [], sourceErrors: [{ hop: "CW-BE" }] };

// The paths of Caseworking's lists as it last listed them, or null before
// this instance has read them once: until then any path may be one.
let cwPaths = null;

export const mayBeCwList = (path) => cwPaths === null || cwPaths.has(path);

const readCwPart = async () => {
  try {
    const buckets = await findCwBuckets({ timeout: CW_TIMEOUT_MS });

    cwPaths = new Set(buckets.map(({ path }) => path));

    return { buckets, sourceErrors: [] };
  } catch (error) {
    logger.warn(`Shell: caseworking unavailable (${describeError(error)})`);

    return CW_UNAVAILABLE;
  }
};

const describeOwn = async (bucket) => {
  try {
    return { entry: await describeBucket(bucket), failed: false };
  } catch (error) {
    logger.warn(`Shell: ${bucket.id} values unread (${error.message})`);

    return {
      entry: describeBucketWith(bucket, unreadValues(bucket)),
      failed: true,
    };
  }
};

const readCatalogue = async () => {
  const [own, cw] = await Promise.all([
    Promise.all(listBuckets().map(describeOwn)),
    readCwPart(),
  ]);
  const buckets = [...own.map(({ entry }) => entry), ...cw.buckets].sort(
    (a, b) => a.order - b.order,
  );
  const failed = own.some((part) => part.failed) || cw.sourceErrors.length > 0;

  return { catalogue: { buckets, sourceErrors: cw.sourceErrors }, failed };
};

const keepFor = (failed) =>
  failed
    ? Math.min(FAILED_MS, config.adminShellCacheMs)
    : config.adminShellCacheMs;

let held = null;
let pending = null;

const refresh = () => {
  pending ??= readCatalogue()
    .then(({ catalogue, failed }) => {
      held = { shell: { catalogue }, expiresAt: Date.now() + keepFor(failed) };

      return held.shell;
    })
    .catch((error) => {
      logger.error(`Shell: catalogue not built (${error.message})`);

      return held?.shell ?? null;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
};

const lateRead = () => new Error("not read by the deadline");

const lastKept = (error) => {
  logger.warn(`Shell: catalogue ${error.message}`);

  return held?.shell ?? null;
};

const waitFor = (deadline) =>
  deadline === null
    ? refresh()
    : beforeDeadline(refresh(), deadline, lateRead).catch(lastKept);

const isCold = () => held === null || config.adminShellCacheMs === 0;

// Never throws: a catalogue that cannot be built is null. Kept for no time,
// each answer waits for its own read. A wait with a `deadline` (epoch ms)
// answers the last catalogue kept, or null, once it passes.
export const readShell = (deadline = null) => {
  if (isCold()) {
    return waitFor(deadline);
  }

  if (Date.now() >= held.expiresAt) {
    refresh();
  }

  return Promise.resolve(held.shell);
};

export const clearShellCache = () => {
  held = null;
  pending = null;
  cwPaths = null;
};
