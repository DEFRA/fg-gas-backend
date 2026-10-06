import { unscaled } from "./map-claimable-entitlement.js";

const numericUnitTypes = ["decimal", "integer"];

const inputFields = (template) =>
  Object.entries(template.fields ?? {}).filter(([, field]) => field.input);

// A grant may collect free text in an input field, so only numbers are
// recorded; any other field is named without its value.
const isNumeric = (field) => numericUnitTypes.includes(field.unitType);

const toEnteredValue = (field, stored) =>
  field.unitType === "decimal" ? unscaled(stored, field.decimalPlaces) : stored;

const withUnit = (field) => (field.unit ? { unit: field.unit } : {});

const toCreatedEntry =
  (entitlement) =>
  ([name, field]) =>
    isNumeric(field)
      ? {
          field: name,
          to: toEnteredValue(field, entitlement.data[name]),
          ...withUnit(field),
        }
      : { field: name };

const toChangedEntry =
  (before, after) =>
  ([name, field]) =>
    isNumeric(field)
      ? {
          field: name,
          from: toEnteredValue(field, before.data[name]),
          to: toEnteredValue(field, after.data[name]),
          ...withUnit(field),
        }
      : { field: name };

const toValues = (entries) => (entries.length > 0 ? { values: entries } : {});

export const toCreatedValues = (template, entitlement) =>
  toValues(inputFields(template).map(toCreatedEntry(entitlement)));

export const toChangedValues = (template, before, after) =>
  toValues(
    inputFields(template)
      .filter(([name]) => before.data[name] !== after.data[name])
      .map(toChangedEntry(before, after)),
  );
