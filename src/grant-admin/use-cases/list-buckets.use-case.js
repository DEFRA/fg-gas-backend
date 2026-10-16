import { describeBucket } from "../../common/buckets/catalogue.js";
import { listBuckets } from "../../common/buckets/registry.js";
import { logger } from "../../common/logger.js";
import {
  describeError,
  findCwBuckets,
} from "../repositories/cw-actuators.repository.js";

const CW_UNAVAILABLE = { buckets: [], sourceErrors: [{ hop: "CW-BE" }] };

// Caseworking's buckets are left out, and it is named, when it cannot be read.
const readCwBuckets = async () => {
  try {
    return { buckets: await findCwBuckets(), sourceErrors: [] };
  } catch (error) {
    logger.warn(
      `List buckets: caseworking unavailable (${describeError(error)})`,
    );

    return CW_UNAVAILABLE;
  }
};

export const listBucketsUseCase = async () => {
  logger.info("List buckets");

  const [own, cw] = await Promise.all([
    Promise.all(listBuckets().map(describeBucket)),
    readCwBuckets(),
  ]);
  const buckets = [...own, ...cw.buckets].sort((a, b) => a.order - b.order);

  logger.info(`Finished: List buckets (${buckets.length} buckets)`);

  return { buckets, sourceErrors: cw.sourceErrors };
};
