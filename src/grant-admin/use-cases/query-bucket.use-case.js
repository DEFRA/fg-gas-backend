import { config } from "../../common/config.js";
import { BUCKET_ID } from "../../common/buckets/bucket.js";
import { parseQuery, runQuery } from "../../common/buckets/engine.js";
import { refuse } from "../../common/buckets/refusal.js";
import { findBucket } from "../../common/buckets/registry.js";
import { logger } from "../../common/logger.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { queryCwBucket } from "../repositories/cw-actuators.repository.js";

// What was asked and how it was read, never a filter value or the ref searched for.
export const buildQueryBucketAudit = (
  { bucket, query, caller, repeat },
  result,
) =>
  buildAuditEvent({
    entity: auditEntities.BUCKET,
    action: auditActions.QUERY_BUCKET,
    entityid: bucket.id,
    details: {
      caller,
      facts: query.asked,
      refKind: query.refKind,
      from: query.from,
      to: query.to,
      page: query.cursor ? "next" : "first",
      plan: query.plan.kind,
      resultCount: result?.rows.length,
      repeat,
    },
    security: PMC_0706_SECURITY,
    segregationRef: "admin-query-bucket",
  });

const auditedQuery = auditedRead(
  ({ bucket, query, deadline }) => runQuery(bucket, query, deadline),
  buildQueryBucketAudit,
  { deadlineOf: ({ deadline }) => deadline ?? Infinity },
);

// An audit still writing at the deadline times the read out, as a slow read does.
const timedOut = (error) => {
  throw error.outOfTime ? refuse("TIMED_OUT") : error;
};

// Parsed before the read, so a refused request writes no audit.
const queryOwnBucket = ({ bucketId, body, caller, repeat, deadline }) => {
  const bucket = findBucket(bucketId);

  if (!bucket) {
    throw refuse("UNKNOWN_BUCKET");
  }

  const query = parseQuery(bucket, body);

  return bucket.audited
    ? auditedQuery({ bucket, query, caller, repeat, deadline }).catch(timedOut)
    : runQuery(bucket, query, deadline);
};

// Caseworking reads for the time the list has left, less a margin for its
// answer to come back; with no more than the margin left, it isn't asked.
const MARGIN_MS = 500;

// The longest time left Caseworking takes; it refuses a longer one.
const CW_MAX_TIME_LEFT_MS = 10_000;

const cwTimeLeftBy = (deadline) => {
  const left = deadline - Date.now();

  return left > MARGIN_MS
    ? {
        timeout: Math.min(config.cwBackend.timeoutMs, left),
        timeLeftMs: Math.min(left - MARGIN_MS, CW_MAX_TIME_LEFT_MS),
      }
    : null;
};

// Caseworking audits its own buckets, so a forwarded read writes none here.
const forwardToCw = async ({
  bucketId,
  body,
  actor,
  repeat,
  deadline,
  signal,
}) => {
  const timing = deadline === undefined ? {} : cwTimeLeftBy(deadline);

  if (timing === null) {
    throw refuse("TIMED_OUT");
  }

  return queryCwBucket(bucketId, body, { actor, repeat, signal, ...timing });
};

const owners = new Map([
  ["gas", queryOwnBucket],
  ["cw", forwardToCw],
]);

const ownerOf = (bucketId) =>
  BUCKET_ID.test(bucketId) ? owners.get(bucketId.split(".")[0]) : undefined;

export const queryBucketUseCase = async (args) => {
  const serve = ownerOf(args.bucketId);

  if (!serve) {
    throw refuse("UNKNOWN_BUCKET");
  }

  logger.info(`Query bucket ${args.bucketId}`);

  const result = await serve(args);

  logger.info(`Finished: Query bucket (${result.rows.length} rows)`);

  return result;
};
