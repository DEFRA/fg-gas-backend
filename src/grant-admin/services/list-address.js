// A list's address as the admin's URLs spell it: each fact under its
// catalogue `param`, a fact's several values as one key each.

// The keys of a list's URL that are not filters.
export const RANGE_KEYS = ["from", "to", "range"];

const byParam = ({ facts }) => new Map(facts.map((fact) => [fact.param, fact]));

const listOf = (value) => [value ?? []].flat().filter(Boolean);

// The keys of a URL this list does not declare: no alias is kept for an old spelling.
export const unknownKeys = (bucket, query) =>
  Object.keys(query).filter(
    (key) => !byParam(bucket).has(key) && !RANGE_KEYS.includes(key),
  );

// The keys of a URL that name a fact taking one value, given more than once.
export const repeatedKeys = (bucket, query) =>
  Object.entries(query)
    .filter(
      ([key, value]) =>
        Array.isArray(value) && byParam(bucket).get(key)?.values === null,
    )
    .map(([key]) => key);

// A fact another sits within names a code, which may have no rows yet; any
// other offers every value it takes.
const isClosed = ({ facts }, fact) =>
  fact.values !== null && !facts.some(({ within }) => within === fact.name);

const isOffered = (fact, one) =>
  fact.values.some((option) => String(option.value) === one);

// The keys of a URL that give a value their fact doesn't offer.
export const unknownValues = (bucket, query) =>
  Object.entries(query)
    .filter(([key, value]) => {
      const fact = byParam(bucket).get(key);

      return (
        fact !== undefined &&
        isClosed(bucket, fact) &&
        listOf(value).some((one) => !isOffered(fact, one))
      );
    })
    .map(([key]) => key);

// A fact whose values are offered may be filtered by several; any other by
// one, the first the address gives.
const toFilter = ({ values }, value) =>
  values === null ? listOf(value)[0] : [...new Set(listOf(value))];

// A URL's query as the list's filters: each declared key back to its fact.
export const fromUrlQuery = (bucket, query) => {
  const facts = byParam(bucket);

  return {
    ...Object.fromEntries(
      Object.entries(query)
        .filter(([key]) => facts.has(key))
        .map(([key, value]) => {
          const fact = facts.get(key);

          return [fact.name, toFilter(fact, value)];
        }),
    ),
    ...Object.fromEntries(
      Object.entries(query).filter(([key]) => RANGE_KEYS.includes(key)),
    ),
  };
};
