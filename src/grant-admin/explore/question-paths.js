const MAX_DEPTH = 12;

const LOCAL_REF = /^#\/(\$defs|definitions)\/([^/]+)$/;

const BRANCHES = ["then", "else"];
const LISTS = ["allOf", "anyOf", "oneOf"];

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const NO_REF = [];

const resolve = (schema, root) => {
  const [, place, name] = LOCAL_REF.exec(schema.$ref) ?? NO_REF;

  return place ? root[place]?.[name] : schema;
};

const isContainer = (schema) =>
  schema.type === "object" ||
  schema.type === "array" ||
  isObject(schema.properties);

const listOf = (value) => (Array.isArray(value) ? value : []);

const propertiesOf = (schema) =>
  Object.entries(isObject(schema.properties) ? schema.properties : {});

// What sits below a schema: its properties, its items, and its alternatives at
// the same place.
const childrenOf = (schema, prefix) => [
  ...propertiesOf(schema).map(([name, child]) => [child, `${prefix}.${name}`]),
  [schema.items, `${prefix}[*]`],
  ...BRANCHES.map((name) => [schema[name], prefix]),
  ...LISTS.flatMap((name) =>
    listOf(schema[name]).map((branch) => [branch, prefix]),
  ),
];

const resolvedOf = (schema, root, depth) =>
  isObject(schema) && depth <= MAX_DEPTH ? resolve(schema, root) : null;

const typeNameOf = ({ type }) =>
  Array.isArray(type) ? type.find((name) => name !== "null") : type;

const DATE_FORMATS = new Set(["date", "date-time"]);

const TYPE_OF = {
  number: () => "number",
  integer: () => "number",
  string: ({ format }) => (DATE_FORMATS.has(format) ? "date" : "text"),
  boolean: () => "boolean",
};

// The search type of a leaf, where its schema says; null where it does not.
const searchTypeOf = (schema) => TYPE_OF[typeNameOf(schema)]?.(schema) ?? null;

// Every leaf an answer can hold below `prefix`, as "answers.a.b[*].c".
const pathsOf = (schema, prefix, root, depth) => {
  const resolved = resolvedOf(schema, root, depth);

  if (!isObject(resolved)) {
    return [];
  }

  const below = childrenOf(resolved, prefix).flatMap(([child, at]) =>
    pathsOf(child, at, root, depth + 1),
  );

  return below.length === 0 && !isContainer(resolved)
    ? [{ path: prefix, type: searchTypeOf(resolved), title: resolved.title }]
    : below;
};

// The answer paths a grant's question schema names, each with its type.
export const questionPaths = (questions) =>
  pathsOf(questions, "answers", questions, 0).filter(
    ({ path }) => path !== "answers",
  );
