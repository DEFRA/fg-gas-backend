import { shapeKey, shownPath } from "../../common/explore/audit.js";
import { parsePath } from "../../common/explore/paths.js";

// A query's literal tree written back in mongosh with every value in a
// filter as ?, so its shape can be recorded without what was looked for.
// Comments and spacing are gone; operators, numbers outside filters, and
// paths and '$path' references in the source's own words stay.
const WORD = /^\w+$/;

const quoted = (text) => (WORD.test(text) ? text : `'${text}'`);

const isPathKey = (key) => !key.startsWith("$") && parsePath(key) !== null;

// A dotted key is a path; any other an operator, a key of the language, a
// root or a column's name, each shown as the source's words let it.
const keyOf = ({ key }, known) =>
  isPathKey(key) && key.includes(".")
    ? quoted(shownPath(key, known))
    : shapeKey(key, known);

const refOf = (value) =>
  value.startsWith("$") && parsePath(value.slice(1)) ? value.slice(1) : null;

// Text outside a filter is a '$path', or distinct's path.
const textOutside = (value, known) => {
  const ref = refOf(value);

  if (ref) {
    return `'$${shownPath(ref, known)}'`;
  }

  return parsePath(value) ? `'${shownPath(value, known)}'` : "?";
};

const IN_FILTER = {
  text: () => "?",
  number: () => "?",
  pattern: () => "/?/",
  date: (node) => `${node.call}(?)`,
};

const OUTSIDE = {
  text: (node, known) => textOutside(node.value, known),
  number: (node) => String(node.value),
  pattern: () => "/?/",
  date: (node) => `${node.call}(?)`,
};

const shapeOfNode = (node, inFilter, known) => {
  const scalars = inFilter ? IN_FILTER : OUTSIDE;

  if (Object.hasOwn(scalars, node.type)) {
    return scalars[node.type](node, known);
  }

  return NESTED[node.type](node, inFilter, known);
};

const NESTED = {
  literal: (node) => String(node.value),
  array: (node, inFilter, known) =>
    `[${node.items.map((item) => shapeOfNode(item, inFilter, known)).join(", ")}]`,
  object: (node, inFilter, known) =>
    node.entries.length
      ? `{ ${node.entries.map((entry) => entryText(entry, inFilter, known)).join(", ")} }`
      : "{}",
};

const entryValue = (entry, inFilter, known) =>
  shapeOfNode(entry.value, inFilter || entry.key === "$match", known);

const entryText = (entry, inFilter, known) =>
  `${keyOf(entry, known)}: ${entryValue(entry, inFilter, known)}`;

// Which arguments of each method are filters.
const FILTER_ARGS = new Map([
  ["find", [0]],
  ["countDocuments", [0]],
  ["distinct", [1]],
]);

const callShape =
  (known) =>
  ({ name, args }) => {
    const filters = FILTER_ARGS.get(name) ?? [];

    return `.${name}(${args.map((arg, n) => shapeOfNode(arg, filters.includes(n), known)).join(", ")})`;
  };

// `known` holds the words the source's paths are made of.
export const shapeOf = (tree, known) =>
  `db.${tree.source.name}${tree.calls.map(callShape(known)).join("")}`;
