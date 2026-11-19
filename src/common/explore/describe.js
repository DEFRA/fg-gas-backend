import { STORED } from "../buckets/bucket.js";
import { REFS, scansOf } from "../buckets/plan.js";
import { readStoredValues, readTimeoutMs } from "../buckets/engine.js";

const declares = {
  fact: (bucket, { fact }) => Object.hasOwn(bucket.facts, fact),
  ref: (bucket, { ref }) =>
    Object.hasOwn(bucket.refs, ref) || bucket.links.includes(ref),
  time: (bucket, _, path) => bucket.time.field === path,
};

// A path's index kind, where its bucket declares what it reads by: none for
// a fact, ref kind or time that bucket lacks.
const isDeclared = (bucket, kind, entry) =>
  !bucket ||
  !Object.hasOwn(declares, kind) ||
  declares[kind](bucket, entry.index, entry.path);

const indexKindOf = (entry, bucket) => {
  const kind = entry.index ? Object.keys(entry.index)[0] : null;

  return isDeclared(bucket, kind, entry) ? kind : null;
};

const factNameOf = (entry) => entry.index?.fact;

const factOf = (bucket, entry) => {
  const facts = bucket ? bucket.facts : {};

  return Object.hasOwn(facts, factNameOf(entry))
    ? facts[factNameOf(entry)]
    : {};
};

const withinOf = (source, bucket, entry) => {
  const { within } = factOf(bucket, entry);
  const other = within
    ? source.paths.find((candidate) => factNameOf(candidate) === within)
    : null;

  return other ? other.path : null;
};

const isClosed = (bucket, entry) =>
  Array.isArray(factOf(bucket, entry).values) || Array.isArray(entry.labels);

// The index scans one ref takes: one for each combination of the bucket's
// lead, which every refs line starts with.
const refScansOf = (bucket) => (bucket ? scansOf(bucket, REFS, []) : 1);

const REF_KINDS = ["ref", "refs"];

// How a time is stored, where its bucket is known.
const timeStoredOf = (bucket) => (bucket ? { stored: bucket.time.type } : {});

const describePath = (source, bucket) => (entry) => {
  const index = indexKindOf(entry, bucket);

  return {
    path: entry.path,
    type: entry.type,
    index,
    closed: isClosed(bucket, entry),
    within: withinOf(source, bucket, entry),
    ...(REF_KINDS.includes(index) && { scans: refScansOf(bucket) }),
    ...(index === "time" && timeStoredOf(bucket)),
  };
};

const firstBucket = (boxes = []) => (boxes.length ? boxes[0].bucket : null);

const bucketOf = ({ bucket, boxes }) => bucket ?? firstBucket(boxes);

// Each known path's index kind, whether its values are closed, and the path
// it is within, as one box's bucket declares them.
export const describePaths = (source, bucket) =>
  new Map(
    source.paths.map((entry) => [
      entry.path,
      describePath(source, bucket)(entry),
    ]),
  );

// What a source reads, as another service reads it: its roots, its known
// paths and how each is read through an index, never its functions.
export const describeSource = (source) => ({
  name: source.name,
  label: source.label,
  service: source.service,
  size: source.size,
  noun: source.noun,
  star: source.star,
  time: source.time,
  roots: rootsOf(source),
  answersAt: source.answersAt ?? null,
  paths: source.paths.map(describePath(source, bucketOf(source))),
});

// The roots a source reads, with those it adds to each record.
export const rootsOf = (source) => [
  ...source.roots,
  ...Object.keys(source.added ?? {}),
];

const MAX_KNOWN = 200;

const knownValue = ({ value, label }) => ({
  value: String(value),
  label: String(label ?? value),
});

const declaredOf = (bucket, field) => {
  const { values } = factOf(bucket, field);

  if (Array.isArray(values)) {
    return values;
  }

  return Array.isArray(field.labels) ? field.labels : null;
};

const storedOf = async (bucket, field) => {
  const values = await readStoredValues(
    bucket,
    factNameOf(field),
    readTimeoutMs(),
  );

  return values?.map((value) => ({ value }));
};

const isStored = (bucket, field) =>
  Boolean(bucket) && factOf(bucket, field).values === STORED;

const listedOf = (bucket, field) =>
  isStored(bucket, field)
    ? storedOf(bucket, field)
    : Promise.resolve(declaredOf(bucket, field));

const knownOf = async (bucket, field) => {
  const values = await listedOf(bucket, field);

  return values && values.length <= MAX_KNOWN ? values : null;
};

// The values each closed path is known to hold, as declared or as read from
// the index (bounded, as the lists read them), for the editor to suggest.
// Open paths, and stored ones with too many values, have none.
export const knownValuesOf = async (source) => {
  const bucket = bucketOf(source);
  const listed = await Promise.all(
    source.paths.map(async (entry) => [
      entry.path,
      await knownOf(bucket, entry),
    ]),
  );

  return new Map(
    listed
      .filter(([, values]) => values)
      .map(([name, values]) => [name, values.map(knownValue)]),
  );
};
