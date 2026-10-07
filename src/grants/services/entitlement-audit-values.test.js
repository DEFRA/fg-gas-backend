import { describe, expect, it } from "vitest";
import {
  toChangedValues,
  toCreatedValues,
} from "./entitlement-audit-values.js";

const template = {
  fields: {
    totalHectares: {
      input: true,
      unitType: "decimal",
      decimalPlaces: 4,
      unit: "HA",
    },
    trees: { input: true, unitType: "integer", unit: "TREES" },
    plots: { input: true, unitType: "integer" },
    reference: { input: true, unitType: "string" },
    actionCode: { input: false, unitType: "string", value: "PA3" },
  },
};

const entitlement = (data) => ({
  data: {
    totalHectares: 1090000,
    trees: 40,
    plots: 2,
    reference: "WMP-1",
    actionCode: "PA3",
    ...data,
  },
});

describe("toCreatedValues", () => {
  it("records every input field, decimals in the units they were entered in", () => {
    expect(toCreatedValues(template, entitlement({}))).toEqual({
      values: [
        { field: "totalHectares", to: 109, unit: "HA" },
        { field: "trees", to: 40, unit: "TREES" },
        { field: "plots", to: 2 },
        { field: "reference", to: "WMP-1" },
      ],
    });
  });

  it("keeps the decimal places that were entered", () => {
    expect(
      toCreatedValues(
        { fields: { totalHectares: template.fields.totalHectares } },
        entitlement({ totalHectares: 455000 }),
      ),
    ).toEqual({ values: [{ field: "totalHectares", to: 45.5, unit: "HA" }] });
  });

  it("records nothing for a template that collects nothing", () => {
    expect(
      toCreatedValues(
        { fields: { actionCode: template.fields.actionCode } },
        entitlement({}),
      ),
    ).toEqual({});
  });
});

describe("toChangedValues", () => {
  it("records each changed field before and after, text included", () => {
    expect(
      toChangedValues(
        template,
        entitlement({}),
        entitlement({ totalHectares: 1000000, trees: 45, reference: "WMP-2" }),
      ),
    ).toEqual({
      values: [
        { field: "totalHectares", from: 109, to: 100, unit: "HA" },
        { field: "trees", from: 40, to: 45, unit: "TREES" },
        { field: "reference", from: "WMP-1", to: "WMP-2" },
      ],
    });
  });

  it("records a changed number without a unit", () => {
    expect(
      toChangedValues(template, entitlement({}), entitlement({ plots: 3 })),
    ).toEqual({ values: [{ field: "plots", from: 2, to: 3 }] });
  });

  it("records nothing when the save changed nothing", () => {
    expect(toChangedValues(template, entitlement({}), entitlement({}))).toEqual(
      {},
    );
  });
});
