import { describe, expect, it } from "vitest";
import { up as repairPayments } from "../../migrations/20260702120000-fix-wmp-payments-pence.js";
import { up as repairAgreementEvents } from "../../migrations/20260929120000-retarget-accepted-agreement-events.js";

describe("retired customer-data migrations", () => {
  it.each([
    ["completed payment correction", repairPayments],
    ["completed Agreement event recovery", repairAgreementEvents],
  ])("does not replay the %s against a database", async (_name, up) => {
    const db = {
      collection() {
        throw new Error("Retired migrations must not access collections");
      },
    };

    await expect(up(db)).resolves.toBeUndefined();
  });
});
