const isPlainNumber = (value) =>
  Number.isFinite(value) &&
  (!Number.isInteger(value) || Number.isSafeInteger(value));

// The prototype, not `constructor`: a plain object may hold a key by that name.
const isPlainObject = (value) =>
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

const objectKindOf = (value) => {
  if (Array.isArray(value)) {
    return "array";
  }

  return isPlainObject(value) ? "object" : "other";
};

// "other" is anything JSON has no word for: a BSON Date, ObjectId, Long,
// Decimal128 or Binary.
export const jsonKindOf = (value) => {
  if (value === null) {
    return "null";
  }

  return typeof value === "object" ? objectKindOf(value) : typeof value;
};

const CHECKS = {
  null: () => true,
  string: () => true,
  boolean: () => true,
  number: isPlainNumber,
  array: (value) => value.every(isPlainJson),
  object: (value) => Object.values(value).every(isPlainJson),
};

/**
 * True when a JSON round trip would give the value back unchanged. A BSON
 * value, an integer past 2^53 - 1 or a non-finite number would not survive
 * one, so an edit saves them as their JSON text. Stops at the first value
 * that fails.
 */
export const isPlainJson = (value) =>
  CHECKS[jsonKindOf(value)]?.(value) ?? false;

const safeOrText = (value) => {
  const number = value.toNumber();

  return Number.isSafeInteger(number) ? number : value.toString();
};

// A Timestamp is a Long.
const BSON_NUMBERS = {
  Long: safeOrText,
  Timestamp: safeOrText,
  Decimal128: (value) => value.toString(),
};

const withJsonNumbersIn = (value) =>
  Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, withJsonNumbers(child)]),
  );

const CONVERSIONS = {
  array: (value) => value.map(withJsonNumbers),
  object: withJsonNumbersIn,
  other: (value) => BSON_NUMBERS[value._bsontype]?.(value) ?? value,
};

/**
 * The value with each BSON number as the JSON an edit can send back: a number
 * where it is exact, its decimal text where it is not. Their own JSON forms
 * are an object and a `$` key. Other values are left to `JSON.stringify`,
 * which gives a Date its ISO text.
 */
export const withJsonNumbers = (value) =>
  CONVERSIONS[jsonKindOf(value)]?.(value) ?? value;
