import { BUCKET_ID } from "../../common/buckets/bucket.js";
import { prepareQuery, runQuery } from "../../common/buckets/engine.js";
import { refuse } from "../../common/buckets/refusal.js";
import { findBucket } from "../../common/buckets/registry.js";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { searchAuditOf } from "../../common/search/audit.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { queryCwBucket } from "../repositories/cw-actuators.repository.js";
import { decodeActor } from "../services/actor-header.js";

const operatorOf = (actor, actorId) => ({
  actor: decodeActor(actor) ?? null,
  actorId: actorId ?? null,
});

// What was asked and how it was read, never a filter value or the value
// searched for: that only as a keyed digest.
export const buildQueryBucketAudit = (
  { bucket, query, caller, actor, actorId, repeat },
  result,
) =>
  buildAuditEvent({
    entity: auditEntities.BUCKET,
    action: auditActions.QUERY_BUCKET,
    entityid: bucket.id,
    details: {
      caller,
      ...operatorOf(actor, actorId),
      facts: query.asked,
      refKind: query.refKind,
      ...searchAuditOf(query, config.search.auditKey),
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
  ({ bucket, query }) => runQuery(bucket, query),
  buildQueryBucketAudit,
);

// Parsed before the read, so a refused request writes no audit.
const queryOwnBucket = async ({
  bucketId,
  body,
  caller,
  actor,
  actorId,
  repeat,
}) => {
  const bucket = findBucket(bucketId);

  if (!bucket) {
    throw refuse("UNKNOWN_BUCKET");
  }

  const query = await prepareQuery(bucket, body);

  return bucket.audited
    ? auditedQuery({ bucket, query, caller, actor, actorId, repeat })
    : runQuery(bucket, query);
};

// Caseworking audits its own buckets, so a forwarded read writes none here.
const forwardToCw = ({ bucketId, body, actor, repeat }) =>
  queryCwBucket(bucketId, body, { actor, repeat });

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
