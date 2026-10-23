import { MAX_SCANS, REFS, factsOf, scansOf } from "./plan.js";

export const BUCKET_ID = /^[a-z]+\.[a-z][a-z0-9-]*$/;

// Where the list is drawn, below the admin's own root: lowercase words joined by slashes.
const BUCKET_PATH = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/;
export const STORED = "stored";
const DATE = "date";

const RESERVED_NAMES = new Set([
  "ref",
  "from",
  "to",
  "range",
  "cursor",
  "searched",
  "limit",
  "groupBy",
  "show",
]);

const isClosed = (fact) => Array.isArray(fact.values);

const hasValues = (fact) => isClosed(fact) || fact.values === STORED;

const leads = (bucket, name) =>
  bucket.indexes.some((line) => factsOf(bucket, line)[0] === name);

const isOpen = (facts) => (name) => !isClosed(facts[name]);

const hidesValues = (fact) =>
  isClosed(fact) && fact.values.some(({ hidden }) => hidden);

const isBadToggle = (fact) => Boolean(fact.toggle) && !isClosed(fact);

const URL_KEY = /^[a-z][a-z0-9]*$/;

const urlKeysOf = (facts) =>
  Object.values(facts).flatMap(({ param, toggle }) =>
    toggle ? [param, toggle.param] : [param],
  );

const isBadKey = (key) => !URL_KEY.test(key ?? "") || RESERVED_NAMES.has(key);

const hidesUnasked = (fact) => hidesValues(fact) && !fact.toggle;

const hasDuplicates = (lines) =>
  new Set(lines.map((line) => line.join("\n"))).size !== lines.length;

const isBadge = (column) => column.format === "badge";

const isUndeclared = (facts) => (name) => !Object.hasOwn(facts, name);

// A summary counts each combination of the `by` facts among the rows `among`
// picks out, so its index line is those facts and then `by`, less any the
// bucket's lead already puts in front of every line.
export const summaryLineOf = ({ by, among }, lead = []) => [
  ...Object.keys(among),
  ...by.filter((fact) => !lead.includes(fact)),
];

const summaryFactsOf = ({ by, among }) => [...Object.keys(among), ...by];

const hasLine = (indexes, wanted) =>
  indexes.some((line) => line.join("\n") === wanted.join("\n"));

const rules = [
  ({ id }) => !BUCKET_ID.test(id) && "has a malformed id",
  ({ path }) =>
    !BUCKET_PATH.test(path ?? "") && "has a missing or malformed path",
  ({ facts }) =>
    Object.keys(facts).some((name) => RESERVED_NAMES.has(name)) &&
    "names a fact with a reserved name",
  ({ facts, indexes }) =>
    indexes.flat().some(isUndeclared(facts)) &&
    "has an index line that names an undeclared fact",
  ({ facts, groupings }) =>
    groupings.some(isUndeclared(facts)) &&
    "has a grouping that names an undeclared fact",
  ({ facts, groupings }) =>
    groupings.some((name) => !hasValues(facts[name])) &&
    "has a grouping with no closed or stored values",
  ({ facts, lead }) =>
    lead.some(isUndeclared(facts)) && "leads with an undeclared fact",
  ({ facts, lead }) =>
    lead.some(isOpen(facts)) && "leads with a fact without closed values",
  (bucket) =>
    scansOf(bucket, [], [], bucket.lead) > MAX_SCANS &&
    "leads with more values than one read may scan",
  ({ facts }) =>
    urlKeysOf(facts).some(isBadKey) &&
    "has a fact or toggle without a URL key of its own, or with a reserved one",
  ({ facts }) =>
    new Set(urlKeysOf(facts)).size !== urlKeysOf(facts).length &&
    "uses one URL key twice",
  ({ facts }) =>
    Object.values(facts).some(isBadToggle) &&
    "has a toggle on a fact without closed values",
  ({ facts }) =>
    Object.values(facts).some(hidesUnasked) &&
    "hides a value of a fact that has no toggle to show it",
  ({ facts }) =>
    Object.entries(facts).some(
      ([name, { within }]) =>
        within !== null && (within === name || isUndeclared(facts)(within)),
    ) && "has a fact within itself or within an undeclared fact",
  ({ facts, indexes }) =>
    Object.entries(facts).some(
      ([name, { within }]) =>
        within !== null && !hasLine(indexes, [within, name]),
    ) && "has a fact within another with no index line of the two",
  (bucket) =>
    Object.entries(bucket.facts).some(
      ([name, fact]) => fact.values === STORED && !leads(bucket, name),
    ) && "has a stored fact that leads no index line",
  ({ indexes }) =>
    hasDuplicates([[], ...indexes]) && "declares the same index line twice",
  ({ facts, columns }) =>
    columns
      .filter(isBadge)
      .some(
        ({ fact }) => isUndeclared(facts)(fact) || !isClosed(facts[fact]),
      ) && "has a badge column that names a fact without closed values",
  ({ audited, timeline }) =>
    audited && timeline && "is both audited and timeline",
  ({ links, refs }) =>
    links.some((kind) => Object.hasOwn(refs, kind)) &&
    "declares a ref kind both as a search and as a link",
  ({ page, tab }) =>
    Boolean(page) !== Boolean(tab) &&
    "declares a page without a tab, or a tab without a page",
  ({ summaries }) =>
    summaries.some(({ by }) => !Array.isArray(by) || by.length === 0) &&
    "has a summary that counts by no fact",
  ({ facts, summaries }) =>
    summaries.flatMap(summaryFactsOf).some(isUndeclared(facts)) &&
    "has a summary that names an undeclared fact",
  ({ facts, summaries }) =>
    summaries.flatMap(({ among }) => Object.keys(among)).some(isOpen(facts)) &&
    "has a summary among a fact without closed values",
  ({ indexes, summaries, lead }) =>
    summaries.some(
      (summary) => !hasLine(indexes, summaryLineOf(summary, lead)),
    ) && "has a summary with no index line of its own",
  // A summary fills only the lead, so a value it must leave out until shown
  // can only be on a lead fact.
  ({ facts, lead, summaries }) =>
    summaries.length > 0 &&
    Object.entries(facts).some(
      ([name, fact]) => hidesValues(fact) && !lead.includes(name),
    ) &&
    "has a summary, and hides values of a fact it does not lead with",
  ({ audited, summaries }) =>
    audited && summaries.length > 0 && "is audited and declares a summary",
];

const problemOf = (bucket) => {
  for (const rule of rules) {
    const problem = rule(bucket);

    if (problem) {
      return problem;
    }
  }

  return null;
};

// `param` is the fact's key in the admin's URLs, and the toggle's its own:
// short words, so a URL reads as what it filters by. A fact `within` another
// has values that mean something only for one value of that other fact.
const toFact = ({
  label,
  values = null,
  toggle = null,
  within = null,
  param,
}) => ({
  label,
  values,
  toggle,
  within,
  param,
});

const toFacts = (facts) =>
  Object.fromEntries(
    Object.entries(facts).map(([name, fact]) => [name, toFact(fact)]),
  );

const defaults = {
  icon: null,
  lead: [],
  facts: {},
  refs: {},
  links: [],
  indexes: [],
  groupings: [],
  columns: [],
  audited: false,
  timeline: false,
  summaries: [],
  page: null,
  tab: null,
};

const withDefaults = (definition) => {
  const bucket = { ...defaults, ...definition };

  return { ...bucket, facts: toFacts(bucket.facts) };
};

const isFreezable = (value) =>
  value !== null && typeof value === "object" && !Object.isFrozen(value);

const deepFreeze = (value) => {
  if (isFreezable(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
};

export const defineBucket = (definition) => {
  const bucket = withDefaults(definition);
  const problem = problemOf(bucket);

  if (problem) {
    throw new Error(`Bucket "${bucket.id}" ${problem}`);
  }

  return deepFreeze(bucket);
};

const ascending = (names) => Object.fromEntries(names.map((name) => [name, 1]));

export const keyOf = (bucket, line) => ({
  ...ascending(bucket.lead),
  ...ascending(line === REFS ? [REFS] : line),
  [bucket.time.field]: -1,
  _id: -1,
});

export const indexKeysOf = (bucket) =>
  [[], ...bucket.indexes, REFS].map((line) => keyOf(bucket, line));

export const toIso = (value) =>
  value === null || value === undefined ? null : new Date(value).toISOString();

export const toStoredTime = (bucket, value) =>
  bucket.time.type === DATE ? new Date(value) : new Date(value).toISOString();
