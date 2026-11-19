import { logger } from "../../../common/logger.js";
import { listGroups } from "../../../common/list-groups/registry.js";
import { isCwBucketId } from "../../repositories/cw-actuators.repository.js";

// Each list group's catalogue entry, built from its members' entries as they
// were read, Caseworking's at run time. A member is never listed on its own.
// The join never throws: a member missing, or two facts that disagree on their
// URL key, builds no group, and the group's list is not listed.

const first = (items, read) =>
  items.map(read).find((value) => value !== undefined && value !== null);

const differs = (items, read) =>
  new Set(items.map(read).filter((value) => value !== undefined)).size > 1;

const unionBy = (lists, keyOf) => {
  const union = new Map();

  lists.flat().forEach((item) => {
    union.set(keyOf(item), [...(union.get(keyOf(item)) ?? []), item]);
  });

  return [...union.values()];
};

const joinValue = (copies) => ({
  value: copies[0].value,
  label: copies[0].label,
  ...Object.fromEntries(
    ["tone", "hint"].flatMap((key) => {
      const value = first(copies, (copy) => copy[key]);

      return value === undefined ? [] : [[key, value]];
    }),
  ),
});

// The values a group puts last keep the order it gives them.
const sortedBy = (last) => (a, b) =>
  last.indexOf(a.value) - last.indexOf(b.value) ||
  String(a.value).localeCompare(String(b.value));

// Listed values are the union, in the first member's order then the rest's,
// or by name where the group sorts them; a fact any member leaves open stays
// open, as that member reads any value.
const joinValues = (group, name, facts) => {
  const lists = facts.map((fact) => fact.values);

  if (!lists.every(Array.isArray)) {
    return null;
  }

  const values = unionBy(lists, ({ value }) => String(value)).map(joinValue);
  const last = group.lastValues?.[name];

  return last ? values.sort(sortedBy(last)) : values;
};

const warnOfDifferences = (group, name, facts) => {
  const values = unionBy(
    facts.map((fact) => fact.values ?? []),
    ({ value }) => String(value),
  );
  const keys = ["label", "tone", "hint"];

  if (
    differs(facts, ({ label }) => label) ||
    differs(facts, ({ within }) => within ?? null) ||
    values.some((copies) =>
      keys.some((key) => differs(copies, (copy) => copy[key])),
    )
  ) {
    logger.warn(`List group ${group.id}: members describe ${name} differently`);
  }
};

const joinFact = (group, [name, facts]) => {
  warnOfDifferences(group, name, facts);

  return {
    name,
    param: facts[0].param,
    label: first(facts, ({ label }) => label),
    values: joinValues(group, name, facts),
    toggle: null,
    within: first(facts, ({ within }) => within) ?? null,
  };
};

const pickFact = ({ pick, members }) => ({
  name: pick.name,
  param: pick.param,
  label: pick.label,
  values: members.map(({ value, label }) => ({ value, label })),
  toggle: null,
  within: null,
});

// One name under two URL keys, or one key for two names, can't be one filter.
const clashOf = (facts) => {
  const params = new Map();

  for (const fact of facts) {
    const named = params.get(fact.param);

    if (named !== undefined && named !== fact.name) {
      return `${fact.param} names both ${named} and ${fact.name}`;
    }

    params.set(fact.param, fact.name);
  }

  return null;
};

const factsOf = (group, entries) => {
  const joined = unionBy(
    entries.map((entry) => entry.facts),
    ({ name }) => name,
  ).map((named) => [named[0].name, named]);
  const split = joined.find(
    ([, named]) => new Set(named.map(({ param }) => param)).size > 1,
  );

  if (split) {
    return { problem: `${split[0]} has two URL keys` };
  }

  const facts = [
    pickFact(group),
    ...joined.map((each) => joinFact(group, each)),
  ];
  const clash = clashOf(facts);

  return clash ? { problem: clash } : { facts };
};

const sharedRefs = (entries) =>
  entries[0].refs.filter(({ kind }) =>
    entries.every(({ refs }) => refs.some((ref) => ref.kind === kind)),
  );

const summariesOf = (entries) =>
  unionBy(
    entries.map(({ summaries }) => summaries),
    ({ id }) => id,
  ).map(([summary]) => summary);

const toEntry = (group, entries, facts) => ({
  id: group.id,
  path: group.path,
  label: group.label,
  service: group.service,
  shortLabel: group.shortLabel,
  icon: group.icon,
  order: group.order,
  noun: group.noun,
  time: group.time,
  facts,
  refs: sharedRefs(entries),
  indexes: [],
  groupings: [],
  title: entries[0].title,
  columns: [
    {
      key: group.pick.name,
      label: group.pick.label,
      format: "label",
      fact: group.pick.name,
    },
    ...entries[0].columns,
  ],
  audited: false,
  timeline: false,
  summaries: summariesOf(entries),
  page: null,
  tab: null,
});

const ownValues = (entry) =>
  new Map(
    entry.facts.map(({ name, values }) => [
      name,
      Array.isArray(values)
        ? new Set(values.map(({ value }) => String(value)))
        : null,
    ]),
  );

// What the read needs and the wire never carries: each member's own values.
const toView = (group, entries, entry) => ({
  id: group.id,
  pick: group.pick,
  ruledOut: group.ruledOut ?? [],
  refs: Object.fromEntries(entry.refs.map(({ kind, label }) => [kind, label])),
  members: group.members.map(({ bucket, value }, i) => ({
    bucket,
    value,
    facts: ownValues(entries[i]),
  })),
});

const buildGroup = (group, byId) => {
  const missing = group.members.find(({ bucket }) => !byId.has(bucket));

  if (missing) {
    return { problem: `${missing.bucket} missing` };
  }

  const entries = group.members.map(({ bucket }) => byId.get(bucket));
  const { facts, problem } = factsOf(group, entries);

  if (problem) {
    return { problem };
  }

  const entry = toEntry(group, entries, facts);

  return { entry, view: toView(group, entries, entry) };
};

// A group over Caseworking's boxes can't be built while they are unread, and
// that is already named by the catalogue's source errors.
const isUnread = (group, cwRead) =>
  !cwRead && group.members.some(({ bucket }) => isCwBucketId(bucket));

const built = (cwRead, byId) => (group) => {
  const { entry, view, problem } = buildGroup(group, byId);

  if (problem) {
    if (!isUnread(group, cwRead)) {
      logger.error(`List group ${group.id} not built: ${problem}`);
    }

    return [];
  }

  return [{ entry, view }];
};

const groupOf = (bucketId) =>
  listGroups().find(({ members }) =>
    members.some(({ bucket }) => bucket === bucketId),
  );

const isGroupMember = (bucketId) => groupOf(bucketId) !== undefined;

// `buckets` is the catalogue as read; every declared group's members are
// hidden, built or not. The views, by group id, are what a group's read splits
// an address by.
export const composeListGroups = (buckets, { cwRead }) => {
  const byId = new Map(buckets.map((entry) => [entry.id, entry]));
  const groups = listGroups().flatMap(built(cwRead, byId));

  return {
    buckets: [
      ...buckets.filter(({ id }) => !isGroupMember(id)),
      ...groups.map(({ entry }) => entry),
    ].sort((a, b) => a.order - b.order),
    views: new Map(groups.map(({ entry, view }) => [entry.id, view])),
  };
};

// The paths of the groups over Caseworking's boxes, which wait on it.
export const cwGroupPaths = () =>
  listGroups()
    .filter(({ members }) => members.some(({ bucket }) => isCwBucketId(bucket)))
    .map(({ path }) => path);

// A list Caseworking lists, unless it is a group's member: a member is only
// ever read through its group.
export const isCwListed = ({ id }) => !isGroupMember(id);

// No list lives under a group's path, so a path there is never Caseworking's.
export const isUnderGroup = (path) =>
  listGroups().some((group) => path.startsWith(`${group.path}/`));

const pickedTo = (bucketId) => {
  const group = groupOf(bucketId);
  const { value } = group.members.find(({ bucket }) => bucket === bucketId);

  return { path: group.path, query: { [group.pick.param]: value } };
};

const isListed = (catalogue, { id }) =>
  catalogue === null || catalogue.buckets.some((entry) => entry.id === id);

// The list that shows a group member's rows: its group's, picked to it, or
// null when `catalogue` doesn't list the group. With no catalogue to read, the
// group's. `bucketId` must be a member of a declared group.
export const listOfGroupMember = (catalogue, bucketId) =>
  isListed(catalogue, groupOf(bucketId)) ? pickedTo(bucketId) : null;
