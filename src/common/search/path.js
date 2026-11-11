const PATH = /^\$(\.[A-Za-z_][A-Za-z0-9_-]*(\[\*\])?)+$/;
const SEGMENT = /\.([A-Za-z_][A-Za-z0-9_-]*)(\[\*\])?/g;

// `$` then `.name` segments, each optionally `[*]`: every element of the array.
export const parsePath = (text) =>
  typeof text === "string" && PATH.test(text)
    ? [...text.matchAll(SEGMENT)].map(([, name, each]) => ({
        name,
        each: each !== undefined,
      }))
    : null;

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const childOf = (name) => (value) =>
  isObject(value) && Object.hasOwn(value, name) ? [value[name]] : [];

const elementsOf = (value) => (Array.isArray(value) ? value : [value]);

// Every value the path reaches; none where it reaches nothing.
export const valuesAt = (view, segments) =>
  segments.reduce(
    (values, { name, each }) => {
      const children = values.flatMap(childOf(name));

      return each ? children.flatMap(elementsOf) : children;
    },
    [view],
  );
