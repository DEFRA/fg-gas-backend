import { logger } from "../logger.js";
import { parseQuery, runQuery } from "./engine.js";
import { findBucket, listBuckets } from "./registry.js";
import { TIMELINE_LIMIT, queryRequestSchema } from "./schema.js";

const readTimelineOf = (ref) => async (bucket) => {
  const { id, label } = bucket;

  try {
    const { value } = queryRequestSchema.validate({
      ref,
      limit: TIMELINE_LIMIT,
    });
    const { rows, page } = await runQuery(bucket, parseQuery(bucket, value));

    return { id, label, rows, more: page.next !== null };
  } catch (error) {
    logger.error(`Timeline: ${id} could not be read (${error.name})`);

    return { id, label, rows: null, more: false };
  }
};

// A record's events: its ref searched in every timeline bucket this service
// registers, each answered apart so one that fails takes none with it.
export const readTimeline = async (ref) => ({
  buckets: await Promise.all(
    listBuckets()
      .filter(({ timeline }) => timeline)
      .map(readTimelineOf(ref)),
  ),
});

// One bucket's rows for a link only it declares, read as a timeline bucket is.
export const readBucketTimeline = async (id, ref) => ({
  buckets: [await readTimelineOf(ref)(findBucket(id))],
});
