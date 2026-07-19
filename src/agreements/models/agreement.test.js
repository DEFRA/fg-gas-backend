import { describe, expect, it } from "vitest";
import { AgreementReference } from "./agreement-reference.js";
import { Agreement } from "./agreement.js";

const referenceValues = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const query = {
  code: referenceValues.code,
  clientRef: referenceValues.clientRef,
  sbi: referenceValues.sbi,
};

const item = {
  agreementItemId: "29b829c4-4e38-405c-9f00-427ee94120a5",
  agreementCode: referenceValues.code,
  clientRef: referenceValues.clientRef,
  identifiers: { sbi: referenceValues.sbi },
};

const toAgreement = (override = {}) =>
  new Agreement({
    agreementNumber: referenceValues.agreementNumber,
    code: referenceValues.code,
    identifiers: { sbi: referenceValues.sbi },
    items: [item],
    ...override,
  });

const toReference = (override = {}) =>
  new AgreementReference({ ...referenceValues, ...override });

describe("Agreement.resolveReference", () => {
  it("resolves a complete reference for a matching Agreement and item", () => {
    expect(toAgreement().resolveReference(query)).toEqual(toReference());
  });

  it.each([
    ["code", { code: "another-code" }],
    ["SBI", { identifiers: { sbi: "999999999" } }],
    ["client reference", { items: [{ ...item, clientRef: "other" }] }],
    ["item SBI", { items: [{ ...item, identifiers: { sbi: "999999999" } }] }],
    ["missing items", { items: undefined }],
  ])("returns undefined for a mismatched %s", (_name, override) => {
    expect(toAgreement(override).resolveReference(query)).toBeUndefined();
  });
});

describe("Agreement.resolveItemReference", () => {
  it("resolves a complete reference for the identified Agreement Item", () => {
    expect(toAgreement().resolveItemReference(item.agreementItemId)).toEqual(
      toReference(),
    );
  });

  it("returns undefined when the Agreement Item does not exist", () => {
    expect(
      toAgreement().resolveItemReference("unknown-item-id"),
    ).toBeUndefined();
  });

  it("returns undefined when the Agreement Item has no SBI", () => {
    const agreement = toAgreement({
      items: [{ ...item, identifiers: undefined }],
    });

    expect(
      agreement.resolveItemReference(item.agreementItemId),
    ).toBeUndefined();
  });
});

describe("Agreement.findItem", () => {
  it("returns the item matching an Agreement Reference", () => {
    expect(toAgreement().findItem(toReference())).toBe(item);
  });

  it.each([
    ["agreement number", { agreementNumber: "PMF000000000" }],
    ["code", { code: "another-code" }],
    ["SBI", { sbi: "999999999" }],
    ["client reference", { clientRef: "other" }],
  ])("returns undefined for a mismatched %s", (_name, override) => {
    expect(toAgreement().findItem(toReference(override))).toBeUndefined();
  });

  it("requires an Agreement Reference", () => {
    expect(() => toAgreement().findItem(referenceValues)).toThrow(
      "Agreement item lookup requires an Agreement Reference",
    );
  });
});

describe("Agreement.withUpdatedItem", () => {
  it("returns a new Agreement with only the matching item replaced", () => {
    const otherItem = {
      ...item,
      agreementItemId: "another-item-id",
      clientRef: "another-client-ref",
    };
    const items = [item, otherItem];
    const agreement = toAgreement({
      items,
      updatedAt: "2026-07-17T11:00:00.000Z",
    });
    const updatedItem = { ...item, state: "accepted" };

    const result = agreement.withUpdatedItem({
      item: updatedItem,
      updatedAt: "2026-07-17T11:30:00.000Z",
    });

    expect(result).toBeInstanceOf(Agreement);
    expect(result).not.toBe(agreement);
    expect(result.items).toEqual([updatedItem, otherItem]);
    expect(result.updatedAt).toBe("2026-07-17T11:30:00.000Z");
    expect(agreement.items).toBe(items);
    expect(agreement.items).toEqual([item, otherItem]);
    expect(agreement.updatedAt).toBe("2026-07-17T11:00:00.000Z");
  });

  it("rejects an item that does not belong to the Agreement", () => {
    const agreement = toAgreement();

    expect(() =>
      agreement.withUpdatedItem({
        item: { ...item, agreementItemId: "unknown-item-id" },
        updatedAt: "2026-07-17T11:30:00.000Z",
      }),
    ).toThrow(
      'Agreement "PMF823153883" does not contain Agreement Item "unknown-item-id"',
    );
  });
});
