import jsonata from "jsonata";

const isRef = (value) => typeof value === "string" && value.startsWith("$.");

export const isPlainObject = (value) =>
  value !== null && typeof value === "object";

const resolveArray = (value, context) =>
  Promise.all(value.map((item) => resolveEffectParams(item, context)));

const resolveObject = async (value, context) => {
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, item]) => [
      key,
      await resolveEffectParams(item, context),
    ]),
  );

  return Object.fromEntries(entries);
};

const hasDefault = (ref) => ref.includes("??");

// A ref with no "??" default is declaring the referenced value is required;
// resolving to undefined means the effect config and the context it's
// evaluated against have drifted out of sync (e.g. a renamed output key),
// so it's surfaced as an error rather than silently persisted.
const resolveRef = async (ref, context) => {
  const resolved = await jsonata(ref).evaluate(context);

  if (resolved === undefined && !hasDefault(ref)) {
    throw new Error(`Unresolved reference "${ref}" in effect params`);
  }

  return resolved;
};

export const resolveEffectParams = async (value, context) => {
  if (isRef(value)) {
    return resolveRef(value, context);
  }

  if (Array.isArray(value)) {
    return resolveArray(value, context);
  }

  if (isPlainObject(value)) {
    return resolveObject(value, context);
  }

  return value;
};
