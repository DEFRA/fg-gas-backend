import { STORED } from "./bucket.js";
import { collectionOf, readStoredValues, readTimeoutMs } from "./engine.js";
import { factsOf } from "./plan.js";

const storedFacts = (bucket) =>
  Object.keys(bucket.facts).filter(
    (name) => bucket.facts[name].values === STORED,
  );

const readAllStoredValues = async (bucket) =>
  Object.fromEntries(
    await Promise.all(
      storedFacts(bucket).map(async (name) => [
        name,
        await readStoredValues(
          bucket,
          name,
          readTimeoutMs(),
          collectionOf({ bucket }),
        ),
      ]),
    ),
  );

const toValueList = (values) =>
  values?.map((value) => ({ value, label: String(value) })) ?? null;

const describeFact =
  (stored) =>
  ([name, fact]) => ({
    name,
    param: fact.param,
    label: fact.label,
    values: fact.values === STORED ? toValueList(stored[name]) : fact.values,
    // Still sent for one release: a GAS on the last one requires it.
    toggle: null,
    within: fact.within,
  });

// A stored fact whose values could not be read offers none.
export const unreadValues = (bucket) =>
  Object.fromEntries(storedFacts(bucket).map((name) => [name, null]));

export const describeBucket = async (bucket) =>
  describeBucketWith(bucket, await readAllStoredValues(bucket));

export const describeBucketWith = (bucket, stored) => {
  return {
    id: bucket.id,
    path: bucket.path,
    label: bucket.label,
    service: bucket.service,
    shortLabel: bucket.shortLabel,
    icon: bucket.icon,
    order: bucket.order,
    noun: bucket.noun,
    time: { label: bucket.time.label },
    facts: Object.entries(bucket.facts).map(describeFact(stored)),
    refs: Object.entries(bucket.refs).map(([kind, label]) => ({ kind, label })),
    indexes: [[], ...bucket.indexes].map((line) => factsOf(bucket, line)),
    groupings: bucket.groupings.filter((name) => stored[name] !== null),
    title: bucket.title,
    columns: bucket.columns,
    audited: bucket.audited,
    timeline: bucket.timeline,
    summaries: bucket.summaries,
    page: bucket.page,
    tab: bucket.tab,
  };
};
