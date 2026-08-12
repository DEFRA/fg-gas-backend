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

// Resolving to undefined means either the required reference is missing or a
// configured fallback also failed. Surface both cases rather than silently
// persisting an incomplete effect result.
const resolveRef = async (ref, context) => {
  const resolved = await jsonata(ref).evaluate(context);

  if (resolved === undefined) {
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
