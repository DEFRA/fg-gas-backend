import { COUNT_CAP } from "../../common/buckets/engine.js";
import {
  OVERVIEW_BUDGET_MS,
  PARTS,
  SERVICES,
  WINDOW_MS,
  readPart,
} from "./overview-reads.js";

// The whole Overview is kept for CACHE_MS on each instance, and requests that
// arrive while it is read share that read. A part that failed is never kept as
// data: the next request reads it again, over the kept answer's window.
export const CACHE_MS = 60_000;

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

const toReadAgain = (overview) => failedParts(overview, KEPT_PARTS);

const withParts = (overview, read) =>
  read.reduce(
    (merged, { part, service, value }) => ({
      ...merged,
      [part]: { ...merged[part], [service]: value },
    }),
    overview,
  );

const deadlineFrom = (now) => now + OVERVIEW_BUDGET_MS;

// A part is read over the answer's own window, so one read again covers what
// the rest do.
const contextOf = (overview, who, deadline) => ({
  ...who,
  from: overview.window.from,
  to: overview.window.to,
  now: new Date(overview.at),
  deadline,
});

// `check` answers a read part as it is to be kept: one whose rows the page
// cannot shape is kept as failed, so it is read again like any other.
const readEach = (wanted, context, check) =>
  Promise.all(
    wanted.map(async ([part, service]) => ({
      part,
      service,
      value: check(part, service, await readPart(part, service, context), {
        from: context.from,
        to: context.to,
      }),
    })),
  );

const readParts = async (overview, wanted, who, deadline, check) =>
  withParts(
    overview,
    await readEach(wanted, contextOf(overview, who, deadline), check),
  );

let held = null;
let pending = null;

const isFresh = (now) => held !== null && now < held.expiresAt;

const readAll = async (who, deadline, check) => {
  const at = new Date();
  const overview = await readParts(
    blankOverview(at),
    KEPT_PARTS,
    who,
    deadline,
    check,
  );

  held = { overview, expiresAt: at.getTime() + CACHE_MS };

  return overview;
};

const readFailed = async (from, who, deadline, check) => {
  const overview = await readParts(
    from.overview,
    toReadAgain(from.overview),
    who,
    deadline,
    check,
  );

  held = { ...from, overview };

  return overview;
};

const startRead = (who, now, check) => {
  const deadline = deadlineFrom(now);

  return isFresh(now)
    ? readFailed(held, who, deadline, check)
    : readAll(who, deadline, check);
};

const readKept = (who, now, check) => {
  if (isFresh(now) && toReadAgain(held.overview).length === 0) {
    return held.overview;
  }

  pending ??= startRead(who, now, check).finally(() => {
    pending = null;
  });

  return pending;
};

// The caller's own parts are read beside the kept ones, not after them, so
// the call has one budget. A shared read began no later than this call, so it
// ends no later.
export const readOverview = async (who, check) => {
  const now = Date.now();
  const [kept, own] = await Promise.all([
    readKept(who, now, check),
    readEach(
      CALLER_PARTS,
      { ...who, now: new Date(now), deadline: deadlineFrom(now) },
      check,
    ),
  ]);

  return withParts(kept, own);
};

export const clearOverviewCache = () => {
  held = null;
  pending = null;
};
