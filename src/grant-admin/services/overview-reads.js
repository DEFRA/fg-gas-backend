import { listApiTokens } from "../../auth/services/api-client.service.js";
import { countBins } from "../../common/buckets/bins.js";
import {
  COUNT_CAP,
  parseQuery,
  runQuery,
} from "../../common/buckets/engine.js";
import { findBucket } from "../../common/buckets/registry.js";
import { queryResponseSchema } from "../../common/buckets/schema.js";
import { parseSummary, runSummary } from "../../common/buckets/summary.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { logger } from "../../common/logger.js";
import { DEAD_LETTER } from "../../events/event-redrive.js";
import {
  countCwDeadLetters,
  findCwBuckets,
  queryCwBucket,
  summariseCwBucket,
} from "../repositories/cw-actuators.repository.js";
import { findCwApiTokens } from "../repositories/cw-clients.repository.js";
import { GATEWAY_TIMEOUT, statusOf } from "../repositories/cw-http.js";

// What each part of the Overview reads, from GAS's own collections and from
// Caseworking's actuators, before it is shaped for the page.

export const SERVICES = ["gas", "cw"];
export const PARTS = [
  "deadLetters",
  "topErrors",
  "configFailed",
  "tokensExpiring",
];

export const WINDOW_MS = 24 * 60 * 60 * 1000;
const BIN_MS = 2 * 60 * 60 * 1000;
const BINS = WINDOW_MS / BIN_MS;

// Every part answers within this, so the whole call, its audit included,
// finishes well inside the admin's own 7 seconds.
export const PART_BUDGET_MS = 4000;

export const CONFIG_FAILED_LIMIT = 100;
export const TOKENS_WITHIN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const GAS_BOXES = ["gas.outbox", "gas.inbox"];
const CW_BOXES = ["cw.outbox", "cw.inbox"];
const ERRORS = "errors";
const ACTIVE = "active";
const FAILED_DEFINITIONS = [
  FetchStatus.PermanentError,
  FetchStatus.TransientError,
];

const GAS_HOP = "GAS";
const CW_HOP = "CW-BE";

// A Caseworking that predates a list or a summary answers it with a reason.
const NOT_OFFERED_REASONS = new Set(["UNKNOWN_BUCKET", "UNKNOWN_SUMMARY"]);

const notOffered = (message) =>
  Object.assign(new Error(message), { cwReason: "NOT_OFFERED" });

const markNotOffered = (error) => {
  if (NOT_OFFERED_REASONS.has(error.output?.payload?.reason)) {
    error.cwReason = "NOT_OFFERED";
  }

  throw error;
};

const boxOf = (bucketId) => bucketId.split(".")[1];

const deadLetterList = (bucket) => ({
  path: bucket.path,
  query: { [bucket.facts.status.param]: DEAD_LETTER },
});

const readGasDeadLetters = async ({ from, to }) => ({
  countCap: COUNT_CAP,
  boxes: await Promise.all(
    GAS_BOXES.map(findBucket).map(async (bucket) => ({
      box: boxOf(bucket.id),
      list: deadLetterList(bucket),
      bins: await countBins(bucket, {
        where: { status: DEAD_LETTER },
        from,
        to,
        binMs: BIN_MS,
      }),
    })),
  ),
});

const isWindowOf = (from) => (bins) =>
  bins.length === BINS && bins[0].from === from;

const readCwDeadLetters = async ({ from, to, actor }) => {
  const { buckets } = await countCwDeadLetters({ from, to }, { actor });

  if (!buckets.every(({ bins }) => isWindowOf(from)(bins))) {
    throw new Error("CW-BE answered bins for another window");
  }

  return {
    countCap: COUNT_CAP,
    boxes: buckets.map(({ id, list, bins }) => ({
      box: boxOf(id),
      list,
      bins,
    })),
  };
};

const labelsOf = (values) =>
  Object.fromEntries((values ?? []).map(({ value, label }) => [value, label]));

const errorsOf = (summaries) =>
  (summaries ?? []).find(({ id }) => id === ERRORS);

const ownBox = (bucket) => ({
  path: bucket.path,
  params: Object.fromEntries(
    Object.entries(bucket.facts).map(([name, { param }]) => [name, param]),
  ),
  labels: labelsOf(bucket.facts.eventType.values),
  among: errorsOf(bucket.summaries).among,
});

// Caseworking's own catalogue entry says how its list spells each filter.
const cwBox = (entries, id) => {
  const entry = entries.find((candidate) => candidate.id === id);
  const errors = errorsOf(entry?.summaries);

  if (!errors) {
    throw notOffered(`CW-BE has no ${id} errors summary`);
  }

  return {
    path: entry.path,
    params: Object.fromEntries(
      entry.facts.map(({ name, param }) => [name, param]),
    ),
    labels: labelsOf(
      entry.facts.find(({ name }) => name === "eventType")?.values,
    ),
    among: errors.among,
  };
};

// Every current dead letter, not the window's: what is still to be dealt with.
const CURRENT = {};

const readGasTopErrors = async () => ({
  summaries: await Promise.all(
    GAS_BOXES.map(findBucket).map(async (bucket) => ({
      box: ownBox(bucket),
      summary: await runSummary(bucket, parseSummary(bucket, ERRORS, CURRENT)),
    })),
  ),
});

const readCwTopErrors = async ({ actor }) => {
  const [entries, ...summaries] = await Promise.all([
    findCwBuckets(),
    ...CW_BOXES.map((id) =>
      summariseCwBucket(id, ERRORS, CURRENT, { actor }).catch(markNotOffered),
    ),
  ]);

  return {
    summaries: summaries.map((summary, i) => ({
      box: cwBox(entries, CW_BOXES[i]),
      summary,
    })),
  };
};

const failedQuery = (fact, definition) => ({
  where: { status: ACTIVE, [fact]: definition },
  limit: CONFIG_FAILED_LIMIT,
  groupBy: [],
});

const toPage = (definition, { rows, page }) => ({
  definition,
  rows,
  more: page.next !== null,
});

const readGasConfigFailed = async () => {
  const grants = findBucket("gas.grants");

  return {
    pages: await Promise.all(
      FAILED_DEFINITIONS.map(async (definition) =>
        toPage(
          definition,
          await runQuery(
            grants,
            parseQuery(grants, failedQuery("worstFetchStatus", definition)),
          ),
        ),
      ),
    ),
  };
};

const readCwPage = (payload) => {
  const { error, value } = queryResponseSchema.validate(payload);

  if (error) {
    throw new Error("CW-BE answered a bucket page that cannot be read");
  }

  return value;
};

const readCwConfigFailed = async ({ actor }) => ({
  pages: await Promise.all(
    FAILED_DEFINITIONS.map(async (definition) =>
      toPage(
        definition,
        readCwPage(
          await queryCwBucket(
            "cw.workflows",
            failedQuery("fetchStatus", definition),
            { actor },
          ).catch(markNotOffered),
        ),
      ),
    ),
  ),
});

const isExpiring =
  (limit) =>
  ({ status, expiresAt }) =>
    status === "EXPIRED" ||
    (status === "ACTIVE" &&
      expiresAt !== null &&
      new Date(expiresAt).getTime() < limit);

const soonestFirst = (a, b) =>
  new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();

// Active tokens expiring within 30 days, and expired ones; revoked ones can
// no longer call, so they are left out.
export const expiringTokens = (tokens, now) =>
  tokens
    .filter(isExpiring(now.getTime() + TOKENS_WITHIN_DAYS * DAY_MS))
    .sort(soonestFirst);

const readGasTokens = async ({ now, callerHash }) => ({
  withinDays: TOKENS_WITHIN_DAYS,
  tokens: expiringTokens((await listApiTokens({ callerHash })).tokens, now),
});

const readCwTokens = async ({ now, actor }) => ({
  withinDays: TOKENS_WITHIN_DAYS,
  tokens: expiringTokens((await findCwApiTokens({ actor })).tokens, now),
});

const readers = {
  deadLetters: { gas: readGasDeadLetters, cw: readCwDeadLetters },
  topErrors: { gas: readGasTopErrors, cw: readCwTopErrors },
  configFailed: { gas: readGasConfigFailed, cw: readCwConfigFailed },
  tokensExpiring: { gas: readGasTokens, cw: readCwTokens },
};

const outOfTime = () =>
  Object.assign(new Error("Overview part out of time"), {
    cwReason: "TIMED_OUT",
    outOfTime: true,
  });

const withinBudget = async (read) => {
  let timer;
  const budget = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(outOfTime()), PART_BUDGET_MS);
  });

  try {
    return await Promise.race([read(), budget]);
  } finally {
    clearTimeout(timer);
  }
};

const hopOf = (service) => (service === "cw" ? CW_HOP : GAS_HOP);

const ownReasonOf = (error) =>
  statusOf(error) === GATEWAY_TIMEOUT ? "TIMED_OUT" : "ERRORED";

// Caseworking's failures, and a part out of time, carry their own reason.
const reasonOf = (service, error) =>
  error.cwReason ?? (service === "cw" ? "ERRORED" : ownReasonOf(error));

// A part that cannot be read says who did not answer and why; the rest stand.
export const readPart = async (part, service, context) => {
  try {
    return {
      data: await withinBudget(() => readers[part][service](context)),
      sourceError: null,
    };
  } catch (error) {
    const sourceError = {
      hop: hopOf(service),
      reason: reasonOf(service, error),
    };

    logger.warn(
      `Overview ${part} of ${service} not read: ${sourceError.hop} ${sourceError.reason}`,
    );

    return { data: null, sourceError };
  }
};
