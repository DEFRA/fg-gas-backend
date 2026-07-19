import { describe, expect, it } from "vitest";
import { applyItemSnapshotEffect } from "./apply-item-snapshot-effect.js";

describe("applyItemSnapshotEffect", () => {
  it("resolves effect.params as an item-shaped patch", async () => {
    const result = await applyItemSnapshotEffect(
      {
        item: { agreementItemId: "item-1" },
        outputs: { fundingCalculation: { amount: 42 } },
      },
      {
        params: {
          supplementaryData: {
            fundingCalculation: "$.outputs.fundingCalculation",
          },
        },
      },
    );

    expect(result).toEqual({
      context: {
        item: {
          agreementItemId: "item-1",
          supplementaryData: { fundingCalculation: { amount: 42 } },
        },
      },
    });
  });

  it("defaults params to an empty object", async () => {
    const result = await applyItemSnapshotEffect(
      { item: { agreementItemId: "item-1" }, outputs: {} },
      {},
    );

    expect(result).toEqual({
      context: { item: { agreementItemId: "item-1" } },
    });
  });

  it("applies configured fields to the item", async () => {
    const result = await applyItemSnapshotEffect(
      {
        executedAt: "2026-07-17T11:30:00.000Z",
        item: { agreementItemId: "item-1", state: "offered" },
      },
      { params: { acceptedAt: "$.executedAt" } },
    );

    expect(result.context.item).toEqual({
      agreementItemId: "item-1",
      state: "offered",
      acceptedAt: "2026-07-17T11:30:00.000Z",
    });
  });

  it("merges configured supplementary data", async () => {
    const result = await applyItemSnapshotEffect(
      {
        item: {
          agreementItemId: "item-1",
          supplementaryData: {
            paymentSchedule: [{ amount: 100 }, { amount: 200 }],
            assessment: { score: 4, reason: "original" },
            note: "clear me",
            preserved: true,
          },
        },
      },
      {
        params: {
          supplementaryData: {
            paymentSchedule: [{ amount: 300 }],
            assessment: { score: 8 },
            note: null,
          },
        },
      },
    );

    expect(result.context.item.supplementaryData).toEqual({
      paymentSchedule: [{ amount: 300 }],
      assessment: { score: 8 },
      note: null,
      preserved: true,
    });
  });
});
