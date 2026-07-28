export const matchesConfiguredValue = (actual, expected) =>
  Array.isArray(actual) ? actual.includes(expected) : actual === expected;
