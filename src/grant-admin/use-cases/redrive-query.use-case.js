import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { REDRIVE_FROM_STATUS } from "../../common/event-redrive.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import {
  countByStatus as countGasInbox,
  findDeadLetterIds as gasInboxDeadLetterIds,
  redriveById as redriveGasInbox,
} from "../../grants/repositories/inbox.repository.js";
import {
  countByStatus as countGasOutbox,
  findDeadLetterIds as gasOutboxDeadLetterIds,
  redriveById as redriveGasOutbox,
} from "../../grants/repositories/outbox.repository.js";
import {
  countCwInbox,
  countCwOutbox,
  describeError,
  findCwDeadLetterIds,
  redriveCwEvent,
} from "../repositories/cw-actuators.repository.js";
import {
  CASEWORKING,
  GAS,
  assertGasAvailable,
  orderErrors,
  selectSources,
  toSourceError,
} from "../services/event-sources.js";

const CONFLICT = 409;

// A bulk redrive has no single entity, but the audit schema wants a string, so
// the action names itself. Doubles as the segregationRef, keeping every bulk
// redrive on one outbox partition.
const BULK_ENTITY_ID = "redrive-query";

// Five at a time per source. High enough that a 500-row redrive is not a
// 500-round-trip queue, low enough that it cannot saturate the Caseworking
// backend or the poller's own Mongo connection pool - this is an ops tool
// running alongside live traffic, not a migration.
const CONCURRENCY = 5;

const REDRIVEN = "redriven";
const CONFLICTED = "conflicts";
const FAILED = "failures";

const countOf = (counts, status) => counts?.[status] ?? 0;

// The Caseworking counts endpoint answers with both facets - per-status counts
// and the box's domain/audit split (see cw-actuators.repository.js). A redrive
// only ever asks "how many are DEAD_LETTER", so it reads the status block and
// ignores the rest, leaving the four sources' `count` uniformly per-status.
const cwStatusCounts = (count) => async (filter) =>
  (await count(filter)).counts;

// A GAS redrive that matched nothing is a row that stopped being DEAD_LETTER
// between the id being collected and the update running - another operator got
// there first, or a poller did. Expected, not an error.
const gasRedrive = (redrive) => async (id, by) =>
  (await redrive(id, { by })) ? REDRIVEN : CONFLICTED;

const isConflict = (error) => error?.output?.statusCode === CONFLICT;

const cwRedrive = (box) => async (id, by) => {
  try {
    await redriveCwEvent(box, id, { by });

    return REDRIVEN;
  } catch (error) {
    if (isConflict(error)) {
      return CONFLICTED;
    }

    throw error;
  }
};

// The same four sources the list, the counts and the breakdown fan out over,
// in the same order, so a sourceError means the same thing everywhere.
const SOURCES = [
  {
    key: "gasInbox",
    service: GAS,
    box: "inbox",
    count: countGasInbox,
    ids: (filter, limit) => gasInboxDeadLetterIds(filter, limit),
    redrive: gasRedrive(redriveGasInbox),
  },
  {
    key: "gasOutbox",
    service: GAS,
    box: "outbox",
    count: countGasOutbox,
    ids: (filter, limit) => gasOutboxDeadLetterIds(filter, limit),
    redrive: gasRedrive(redriveGasOutbox),
  },
  {
    key: "cwInbox",
    service: CASEWORKING,
    box: "inbox",
    count: cwStatusCounts(countCwInbox),
    ids: (filter, limit) => findCwDeadLetterIds("inbox", filter, limit),
    redrive: cwRedrive("inbox"),
  },
  {
    key: "cwOutbox",
    service: CASEWORKING,
    box: "outbox",
    count: cwStatusCounts(countCwOutbox),
    ids: (filter, limit) => findCwDeadLetterIds("outbox", filter, limit),
    redrive: cwRedrive("outbox"),
  },
];

// A fixed-size worker pool rather than `Promise.all` over every id: the point
// is to bound concurrency, and `Promise.all` over 500 ids would not.
const runPool = async (items, worker) => {
  const outcomes = [];
  let next = 0;

  const run = async () => {
    while (next < items.length) {
      const index = next++;

      outcomes[index] = await worker(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, run),
  );

  return outcomes;
};

const tally = (outcomes) => {
  const counts = { [REDRIVEN]: 0, [CONFLICTED]: 0, [FAILED]: 0 };

  for (const outcome of outcomes) {
    counts[outcome] += 1;
  }

  return counts;
};

// Anything that is neither a success nor a conflict is counted and moved past:
// one row that will not redrive must not abandon the other 499. The failure is
// logged with the id so it can be chased.
const guarded = (source, by) => async (id) => {
  try {
    return await source.redrive(id, by);
  } catch (error) {
    logger.warn(
      { source: source.key, id },
      `redrive-by-filter failed: ${describeError(error)}`,
    );

    return FAILED;
  }
};

const processSource = async (source, { filter, budget, actor }) => {
  const matched = countOf(await source.count(filter), REDRIVE_FROM_STATUS);
  const ids = budget > 0 ? await source.ids(filter, budget) : [];
  const outcomes = await runPool(ids, guarded(source, actor));

  return { matched, processed: ids.length, ...tally(outcomes) };
};

const KEYS = ["matched", "processed", REDRIVEN, CONFLICTED, FAILED];

const totals = (perSource) => {
  const sum = Object.fromEntries(KEYS.map((key) => [key, 0]));

  for (const result of Object.values(perSource)) {
    for (const key of KEYS) {
      sum[key] += result[key];
    }
  }

  return sum;
};

// Redrive every dead letter a filter selects.
//
// `status` is implicitly and only DEAD_LETTER: the filter is otherwise exactly
// the list's, so anything an operator can see they can redrive, and nothing
// else. Sources are processed in their fixed order and share ONE budget, so
// `limit` caps the work of this call rather than the size of the match -
// `matched` and `processed` are both reported so an operator can see there is
// more to do and fire it again.
//
// Ids are collected per source BEFORE any redrive in that source runs:
// redriving moves a row out of DEAD_LETTER, so collecting and redriving in one
// interleaved walk would silently skip rows.
const redriveQuery = async ({
  service,
  q,
  error,
  from,
  to,
  limit,
  actor,
}) => {
  logger.info(`Redrive events by filter (limit ${limit})`);

  const filter = { q, error, from, to };
  const { selected, sourceErrors } = selectSources(service, SOURCES);
  const perSource = {};
  const errors = [];
  let budget = limit;

  for (const source of selected) {
    try {
      const result = await processSource(source, { filter, budget, actor });

      perSource[source.key] = result;
      budget -= result.processed;
    } catch (failure) {
      logger.error(failure, `redrive-by-filter: ${source.key} unavailable`);
      errors.push(toSourceError(source, describeError(failure)));
    }
  }

  assertGasAvailable(selected, errors);

  const sums = totals(perSource);

  logger.info(
    `Finished: Redrive events by filter (${sums.redriven}/${sums.processed} of ${sums.matched})`,
  );

  return {
    ...sums,
    perSource,
    sourceErrors: orderErrors([...sourceErrors, ...errors]),
  };
};

// The counts as they go into the audit event. Zeroed when the use case threw
// before producing any - `withAudit` still writes a FAILURE event, and a
// refused bulk redrive is still an attempt worth recording.
const EMPTY_SUMMARY = {
  ...Object.fromEntries(KEYS.map((key) => [key, 0])),
  perSource: {},
};

const summaryOf = (result) => ({ ...EMPTY_SUMMARY, ...result });

// ONE audit event for the whole call - a bulk redrive is a single operator
// decision, and one event per row would bury the audit log. The filter that
// selected the rows and the counts that came back are both recorded, so the
// event says what was asked for as well as what happened.

export const redriveQueryAuditBuilder = (
  [{ service, q, error, from, to, limit, caller, actor }],
  result,
) =>
  buildAuditEvent({
    entity: auditEntities.EVENT,
    action: auditActions.REDRIVE_EVENTS,
    entityid: BULK_ENTITY_ID,
    details: {
      filter: { service, q, error, from, to, limit },
      caller,
      actor: actor ?? null,
      ...summaryOf(result),
    },
    segregationRef: `event-${BULK_ENTITY_ID}`,
  });

export const redriveQueryUseCase = withAudit(
  redriveQuery,
  redriveQueryAuditBuilder,
);
