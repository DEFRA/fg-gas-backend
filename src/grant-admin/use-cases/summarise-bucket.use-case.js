import { BUCKET_ID } from "../../common/buckets/bucket.js";
import { parseSummary, runSummary } from "../../common/buckets/summary.js";
import { refuse } from "../../common/buckets/refusal.js";
import { findBucket } from "../../common/buckets/registry.js";
import { logger } from "../../common/logger.js";
import { summariseCwBucket } from "../repositories/cw-actuators.repository.js";

const summariseOwnBucket = ({ bucketId, summaryId, body }) => {
  const bucket = findBucket(bucketId);

  if (!bucket) {
    throw refuse("UNKNOWN_BUCKET");
  }

  return runSummary(bucket, parseSummary(bucket, summaryId, body));
};

const forwardToCw = ({ bucketId, summaryId, body, actor }) =>
  summariseCwBucket(bucketId, summaryId, body, { actor });

const owners = new Map([
  ["gas", summariseOwnBucket],
  ["cw", forwardToCw],
]);

const ownerOf = (bucketId) =>
  BUCKET_ID.test(bucketId) ? owners.get(bucketId.split(".")[0]) : undefined;

export const summariseBucketUseCase = async (args) => {
  const serve = ownerOf(args.bucketId);

  if (!serve) {
    throw refuse("UNKNOWN_BUCKET");
  }

  logger.info(`Summarise bucket ${args.bucketId} (${args.summaryId})`);

  const result = await serve(args);

  logger.info(`Finished: Summarise bucket (${result.entries.length} entries)`);

  return result;
};
