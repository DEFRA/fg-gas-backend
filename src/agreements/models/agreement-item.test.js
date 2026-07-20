import { describe, expect, it } from "vitest";
import { AgreementItem } from "./agreement-item.js";

const createItem = (overrides = {}) =>
  new AgreementItem({
    agreementItemId: "item-1",
    agreementCode: "pigs-might-fly",
    clientRef: "client-1",
    state: "offered",
    supplementaryData: {
      assessment: { score: 4, reason: "original" },
      paymentSchedule: [{ amount: 100 }, { amount: 200 }],
      preserved: true,
    },
    ...overrides,
  });

describe("AgreementItem.applySnapshot", () => {
  it("applies an approved first-class field without mutating the item", () => {
    const item = createItem();

    const result = item.applySnapshotPatch({
      acceptedAt: "2026-07-17T11:30:00.000Z",
    });

    expect(result).toBeInstanceOf(AgreementItem);
    expect(result).toMatchObject({
      agreementItemId: "item-1",
      state: "offered",
      acceptedAt: "2026-07-17T11:30:00.000Z",
    });
    expect(item.acceptedAt).toBeUndefined();
  });

  it("preserves supplementary siblings while replacing configured field values", () => {
    const result = createItem().applySnapshotPatch({
      supplementaryData: {
        assessment: { score: 8 },
        paymentSchedule: [{ amount: 300 }],
        note: null,
      },
    });

    expect(result.supplementaryData).toEqual({
      assessment: { score: 8 },
      paymentSchedule: [{ amount: 300 }],
      note: null,
      preserved: true,
    });
  });

  it("allows arbitrary scheme-specific fields within supplementary data", () => {
    const result = createItem().applySnapshotPatch({
      supplementaryData: {
        schemeSpecificResult: { outcome: "eligible" },
      },
    });

    expect(result.supplementaryData.schemeSpecificResult).toEqual({
      outcome: "eligible",
    });
  });
});
