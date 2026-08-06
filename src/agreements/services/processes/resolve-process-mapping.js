import jsonata from "jsonata";

const jsonataPrefix = "jsonata:";
const rootReferencePattern =
  /^\$\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|\*)\])*$/;
const rowReferencePattern =
  /^@\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|\*)\])*$/;
const rowTermPattern = /(^|[^\w'"@$])@\./g;

const isExpression = (mapping) => mapping.startsWith(jsonataPrefix);
const isDirectReference = (mapping) =>
  rootReferencePattern.test(mapping) || rowReferencePattern.test(mapping);

const toExpression = (mapping) => {
  const expression = isExpression(mapping)
    ? mapping.slice(jsonataPrefix.length)
    : mapping;

  return expression.replace(rowTermPattern, (_, prefix) => `${prefix}$row.`);
};

const requireResolved = (resolved, mapping) => {
  if (resolved === undefined) {
    throw new Error(`Unresolved process mapping "${mapping}"`);
  }

  return Array.isArray(resolved) ? [...resolved] : resolved;
};

const evaluate = async (mapping, { context, row }) => {
  const expression = jsonata(toExpression(mapping));

  if (row !== undefined) {
    expression.assign("row", row);
  }

  return expression.evaluate(context);
};

const resolveString = async (mapping, scope) => {
  if (!isExpression(mapping) && !isDirectReference(mapping)) {
    return mapping;
  }

  return requireResolved(await evaluate(mapping, scope), mapping);
};

const resolveArray = (mapping, scope) =>
  Promise.all(mapping.map((value) => resolveMapping(value, scope)));

const isObject = (mapping) => mapping !== null && typeof mapping === "object";
const hasOwn = (mapping, key) => Object.hasOwn(mapping, key);
const isCollectionMapping = (mapping) => hasOwn(mapping, "itemsRef");

const requireCollectionShape = (mapping) => {
  if (!hasOwn(mapping, "itemsRef") || !hasOwn(mapping, "items")) {
    throw new Error(
      'Process collection mapping requires both "itemsRef" and "items"',
    );
  }

  const extraFields = Object.keys(mapping).filter(
    (key) => key !== "itemsRef" && key !== "items",
  );
  if (extraFields.length > 0) {
    throw new Error(
      'Process collection mapping only supports "itemsRef" and "items"',
    );
  }
};

const requireArray = (value, reference) => {
  if (!Array.isArray(value)) {
    throw new Error(
      `Process collection mapping "${reference}" must resolve to an array`,
    );
  }

  return value;
};

const toExpressionRows = (value) => {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? [...value] : [value];
};

const resolveCollectionRows = async (reference, scope) =>
  isExpression(reference)
    ? toExpressionRows(await evaluate(reference, scope))
    : requireArray(await resolveString(reference, scope), reference);

const resolveCollection = async (mapping, scope) => {
  requireCollectionShape(mapping);
  const rows = await resolveCollectionRows(mapping.itemsRef, scope);

  return Promise.all(
    rows.map((row) => resolveMapping(mapping.items, { ...scope, row })),
  );
};

const resolveObjectEntries = async (mapping, scope) => {
  const entries = await Promise.all(
    Object.entries(mapping).map(async ([key, value]) => [
      key,
      await resolveMapping(value, scope),
    ]),
  );

  return Object.fromEntries(entries);
};

const resolveObject = (mapping, scope) =>
  isCollectionMapping(mapping)
    ? resolveCollection(mapping, scope)
    : resolveObjectEntries(mapping, scope);

const resolveMapping = async (mapping, scope) => {
  if (typeof mapping === "string") {
    return resolveString(mapping, scope);
  }

  if (Array.isArray(mapping)) {
    return resolveArray(mapping, scope);
  }

  return isObject(mapping) ? resolveObject(mapping, scope) : mapping;
};

export const resolveProcessMapping = async (mapping, context) =>
  resolveMapping(mapping, { context });
