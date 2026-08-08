const isMappingObject = (value) =>
  value !== null && !Array.isArray(value) && typeof value === "object";

const arrayItemSchema = (schema) => schema.items?.[0] ?? {};
const fieldsFor = (schema) => schema.keys ?? {};
const allowsUnknownFields = (schema) => schema.flags?.unknown;
const isUnknownField = (schema) =>
  !schema || schema.flags?.presence === "forbidden";

const findInArray = (mapping, schema, path) =>
  Object.hasOwn(mapping, "items")
    ? findUnknownMappingField(mapping.items, arrayItemSchema(schema), path)
    : undefined;

const findInField = (value, schema, path) =>
  isUnknownField(schema) ? path : findUnknownMappingField(value, schema, path);

const findInObject = (mapping, schema, path) => {
  if (allowsUnknownFields(schema)) {
    return undefined;
  }

  const fields = fieldsFor(schema);

  for (const [key, value] of Object.entries(mapping)) {
    const fieldPath = `${path}.${key}`;
    const unknown = findInField(value, fields[key], fieldPath);
    if (unknown) {
      return unknown;
    }
  }

  return undefined;
};

const fieldFinders = {
  array: findInArray,
  object: findInObject,
};

export const findUnknownMappingField = (mapping, schema, path) => {
  if (!isMappingObject(mapping)) {
    return undefined;
  }

  return fieldFinders[schema.type]?.(mapping, schema, path);
};
