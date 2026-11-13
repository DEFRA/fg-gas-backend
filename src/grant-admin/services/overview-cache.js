import { COUNT_CAP } from "../../common/buckets/engine.js";
import { PARTS, SERVICES, WINDOW_MS, readPart } from "./overview-reads.js";

// The whole Overview is kept for CACHE_MS on each instance, and requests that
// arrive while it is first read share that read. A part that failed is never
// kept as data: the kept answer is served at once while that part is read
// again in the background, over the same window, after a growing pause. A
// Caseworking that does not offer a part is not asked again until the answer
// expires.
export const CACHE_MS = 60_000;
export const FIRST_RETRY_MS = 5_000;

const blankOverview = (at) => ({
  at: at.toISOString(),
  window: {
    from: new Date(at.getTime() - WINDOW_MS).toISOString(),
    to: at.toISOString(),
  },
  countCap: COUNT_CAP,
  ...Object.fromEntries(PARTS.map((part) => [part, {}])),
});

const EVERY_PART = PARTS.flatMap((part) =>
  SERVICES.map((service) => [part, service]),
);

// The tokens name the caller's own token (`inUse`), so they are read for each
// request and never kept; the rest is the same for every caller.
const PER_CALLER = new Set(["tokensExpiring"]);
const KEPT_PARTS = EVERY_PART.filter(([part]) => !PER_CALLER.has(part));
const CALLER_PARTS = EVERY_PART.filter(([part]) => PER_CALLER.has(part));

export const failedParts = (overview, parts = EVERY_PART) =>
  parts.filter(
    ([part, service]) => overview[part][service].sourceError !== null,
  );

const isRetryable =
  (overview) =>
  ([part, service]) =>
    overview[part][service].sourceError.reason !== "NOT_OFFERED";

const withParts = (overview, read) =>
  read.reduce(
    (merged, { part, service, value }) => ({
      ...merged,
      [part]: { ...merged[part], [service]: value },
    }),
    overview,
  );

// A part is read over the answer's own window, so a retried one covers what
// the rest do.
const contextOf = (overview, who) => ({
  ...who,
  from: overview.window.from,
  to: overview.window.to,
  now: new Date(overview.at),
});

const readParts = async (overview, wanted, who) =>
  withParts(
    overview,
    await Promise.all(
      wanted.map(async ([part, service]) => ({
        part,
        service,
        value: await readPart(part, service, contextOf(overview, who)),
      })),
    ),
  );

let held = null;
let pending = null;
let retrying = null;

const isFresh = (now) => held !== null && now < held.expiresAt;

const readAll = async (who) => {
  const at = new Date();
  const overview = await readParts(blankOverview(at), KEPT_PARTS, who);

  held = {
    overview,
    expiresAt: at.getTime() + CACHE_MS,
    retryAt: at.getTime() + FIRST_RETRY_MS,
    retryMs: FIRST_RETRY_MS,
  };

  return overview;
};

// Merged only into the answer it was started from: one replaced or expired
// meanwhile is left as it is.
const retry = async (from, who) => {
  const overview = await readParts(
    from.overview,
    failedParts(from.overview, KEPT_PARTS).filter(isRetryable(from.overview)),
    who,
  );

  if (held === from) {
    held = { ...from, overview };
  }
};

const startRetry = (now, who) => {
  const wanted = failedParts(held.overview, KEPT_PARTS).filter(
    isRetryable(held.overview),
  );

  if (retrying || wanted.length === 0 || now < held.retryAt) {
    return;
  }

  held.retryMs *= 2;
  held.retryAt = now + held.retryMs;
  retrying = retry(held, who).finally(() => {
    retrying = null;
  });
};

const readKept = (who) => {
  const now = Date.now();

  if (isFresh(now)) {
    startRetry(now, who);

    return held.overview;
  }

  pending ??= readAll(who).finally(() => {
    pending = null;
  });

  return pending;
};

export const readOverview = async (who) => {
  const kept = await readKept(who);

  return readParts(kept, CALLER_PARTS, who);
};

// The background retry, if one is running.
export const overviewRetry = () => retrying;

export const clearOverviewCache = () => {
  held = null;
  pending = null;
  retrying = null;
};
