import { listApiTokens } from "../../auth/services/api-client.service.js";
import { beforeDeadline } from "../../common/before-deadline.js";
import { countBins } from "../../common/buckets/bins.js";
import {
  COUNT_CAP,
  parseQuery,
  runQuery,
} from "../../common/buckets/engine.js";
import { findBucket } from "../../common/buckets/registry.js";
import { parseSummary, runSummary } from "../../common/buckets/summary.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { DEAD_LETTER } from "../../events/event-redrive.js";
import {
  countCwDeadLetters,
  findCwBuckets,
  readCwBucketPage,
  summariseCwBucket,
} from "../repositories/cw-actuators.repository.js";
import { findCwApiTokens } from "../repositories/cw-clients.repository.js";
import { GATEWAY_TIMEOUT, statusOf } from "../repositories/cw-http.js";
import { buildApiClientAudit } from "../use-cases/api-client-audit.js";
import { TOKENS_WITHIN_DAYS, isExpiringSoon } from "./token-expiry.js";

// What each part of the Overview reads, from GAS's own collections and from
// Caseworking's actuators, before it is shaped for the page.

export const SERVICES = ["gas", "cw"];
export const PARTS = [
  "deadLetters",
  "topErrors",
  "configFailed",
  "tokensExpiring",
];

const DAY_MS = 24 * 60 * 60 * 1000;
export const WINDOW_MS = DAY_MS;
const BIN_MS = 2 * 60 * 60 * 1000;

// One budget for the whole call: its parts are read side by side, each
// token audit inside its part, so the call finishes well inside the admin's
// own 7 seconds.
export const OVERVIEW_BUDGET_MS = 4000;

export const CONFIG_FAILED_LIMIT = 100;

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

const readCwDeadLetters = async ({ from, to, actor }) => {
  const { countCap, buckets } = await countCwDeadLetters(
    { from, to, binMs: BIN_MS },
    { actor },
  );

  return {
    countCap,
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
    throw Object.assign(new Error(`CW-BE has no ${id} errors summary`), {
      cwReason: "ERRORED",
    });
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
    ...CW_BOXES.map((id) => summariseCwBucket(id, ERRORS, CURRENT, { actor })),
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

const readCwConfigFailed = async ({ actor }) => ({
  pages: await Promise.all(
    FAILED_DEFINITIONS.map(async (definition) =>
      toPage(
        definition,
        await readCwBucketPage(
          "cw.workflows",
          failedQuery("fetchStatus", definition),
          { actor },
        ),
      ),
    ),
  ),
});

const isExpiring = (now) => (token) =>
  token.status === "EXPIRED" || isExpiringSoon(token, now);

const soonestFirst = (a, b) =>
  new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();

// Active tokens expiring within 30 days, and expired ones; revoked ones can
// no longer call, so they are left out.
export const expiringTokens = (tokens, now) =>
  tokens.filter(isExpiring(now)).sort(soonestFirst);

const tokensAudit = (service) => (context, result, error) =>
  buildApiClientAudit(auditActions.VIEW_API_CLIENT, PMC_0706_SECURITY)(
    { service, caller: context.caller, actor: context.decodedActor },
    result,
    error,
  );

// Released, as the tokens page releases them, only once their view is
// audited. A service that lists none has released nothing to audit. Read by
// the call's deadline, so a list that answers after it is never audited as
// viewed.
const auditedTokens = (service, list) =>
  auditedRead(
    async (context) => ({
      withinDays: TOKENS_WITHIN_DAYS,
      tokens: expiringTokens((await list(context)).tokens, context.now),
    }),
    tokensAudit(service),
    {
      releases: ({ tokens }) => tokens.length > 0,
      deadlineOf: ({ deadline }) => deadline,
    },
  );

const readGasTokens = auditedTokens("gas", ({ callerHash }) =>
  listApiTokens({ callerHash }),
);

const readCwTokens = auditedTokens("cw", ({ actor }) =>
  findCwApiTokens({ actor }),
);

const outOfTime = () =>
  Object.assign(new Error("Overview part out of time"), { outOfTime: true });

const byDeadline = (read) => (context) =>
  beforeDeadline(read(context), context.deadline, outOfTime);

// The tokens' audited read keeps the deadline itself, so tokens whose audit
// committed are never withheld.
const readers = {
  deadLetters: {
    gas: byDeadline(readGasDeadLetters),
    cw: byDeadline(readCwDeadLetters),
  },
  topErrors: {
    gas: byDeadline(readGasTopErrors),
    cw: byDeadline(readCwTopErrors),
  },
  configFailed: {
    gas: byDeadline(readGasConfigFailed),
    cw: byDeadline(readCwConfigFailed),
  },
  tokensExpiring: { gas: readGasTokens, cw: readCwTokens },
};

// Tokens withheld for want of their audit are GAS's failure, whoever listed
// them.
const hopOf = (service, error) =>
  service === "cw" && !error.auditNotWritten ? CW_HOP : GAS_HOP;

const ownReasonOf = (error) =>
  statusOf(error) === GATEWAY_TIMEOUT ? "TIMED_OUT" : "ERRORED";

// Caseworking's failures carry their own reason.
const reasonOf = (service, error) => {
  if (error.outOfTime) {
    return "TIMED_OUT";
  }

  return (
    error.cwReason ??
    (hopOf(service, error) === CW_HOP ? "ERRORED" : ownReasonOf(error))
  );
};

// A part that cannot be read says who did not answer and why; the rest stand.
// Each answers by the `deadline` of the call it was read for.
export const readPart = async (part, service, context) => {
  try {
    return {
      data: await readers[part][service](context),
      sourceError: null,
    };
  } catch (error) {
    const sourceError = {
      hop: hopOf(service, error),
      reason: reasonOf(service, error),
    };

    logger.warn(
      `Overview ${part} of ${service} not read: ${sourceError.hop} ${sourceError.reason}`,
    );

    return { data: null, sourceError };
  }
};
