// Case-insensitive: ObjectId parses either case to the same id.
export const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

export const isObjectIdHex = (value) =>
  typeof value === "string" && OBJECT_ID_HEX.test(value);
