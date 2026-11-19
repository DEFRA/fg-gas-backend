import { toRef } from "../../../common/buckets/refs.js";
import { refuse } from "../../../common/buckets/refusal.js";

const listOf = (value) => [value].flat();

// One value as itself, several as a list, as the list's own `where` has them.
const shaped = (values) => (values.length === 1 ? values[0] : values);

const asksBoth = (asked, { beside, fact }) =>
  asked !== null && Object.hasOwn(asked, beside) && Object.hasOwn(asked, fact);

// A value no row can hold beside another asked fact is taken out; with none
// left, nothing matches.
const withoutRuledOut = (ruledOut, where) =>
  ruledOut.reduce((asked, rule) => {
    if (!asksBoth(asked, rule)) {
      return asked;
    }

    const kept = listOf(asked[rule.fact]).filter((each) => each !== rule.value);

    return kept.length > 0 ? { ...asked, [rule.fact]: shaped(kept) } : null;
  }, where);

// A member reads a fact it declares, narrowed to the values it lists.
const memberFilter = (member, [name, value]) => {
  if (!member.facts.has(name)) {
    return null;
  }

  const own = member.facts.get(name);

  if (own === null) {
    return [name, value];
  }

  const kept = listOf(value).filter((each) => own.has(String(each)));

  return kept.length > 0 ? [name, shaped(kept)] : null;
};

const memberWhere = (member, where) => {
  const filters = Object.entries(where).map((filter) =>
    memberFilter(member, filter),
  );

  return filters.includes(null) ? null : Object.fromEntries(filters);
};

// The members an address reads, each with its own `where`: those picked, or
// all, less any that hold none of a value asked or don't declare its fact.
export const splitAddress = (group, where) => {
  const { [group.pick.name]: picked, ...asked } = where;
  const wanted = new Set(
    picked === undefined
      ? group.members.map(({ value }) => value)
      : listOf(picked),
  );
  const ruled = withoutRuledOut(group.ruledOut, asked);

  if (ruled === null) {
    return [];
  }

  return group.members
    .filter(({ value }) => wanted.has(value))
    .map((member) => ({ ...member, where: memberWhere(member, ruled) }))
    .filter((member) => member.where !== null);
};

const isSearchable = (group, kind, value) =>
  Object.hasOwn(group.refs, kind) && toRef(kind, value) !== null;

// Refused before any read, as a member would refuse it: only a kind every
// member searches by, with a value to search for.
export const checkSearch = (group, search) => {
  if (search === undefined || search === null) {
    return;
  }

  const colon = search.indexOf(":");

  if (
    !isSearchable(
      group,
      search.slice(0, Math.max(colon, 0)),
      search.slice(colon + 1),
    )
  ) {
    throw refuse("UNKNOWN_REF_KIND");
  }
};
