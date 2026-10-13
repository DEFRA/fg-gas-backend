const buckets = new Map();

export const registerBucket = (bucket) => {
  if (buckets.has(bucket.id)) {
    throw new Error(`Bucket "${bucket.id}" is already registered`);
  }

  buckets.set(bucket.id, bucket);
};

export const findBucket = (id) => buckets.get(id);

export const listBuckets = () =>
  [...buckets.values()].sort((a, b) => a.order - b.order);

export const clearBuckets = () => buckets.clear();
