import { describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { saveEvents } from "../../events/index.js";
import { storeClaimCaseUseCase } from "./store-claim-case.use-case.js";
vi.mock("../../events/index.js");
const claim = {
  metadata: { clientRef: "app-1", grantCode: "woodland", sbi: "113593357" },
  clientClaimRef: "claim-1",
  claimCode: "PA3",
  claim: { totalClaimAmountPence: 0 },
  createdAt: "2026-08-07T11:16:05.745Z",
};
it("queues a data-only event with the claim transaction's session", async () => {
  const session = { transaction: true };
  await storeClaimCaseUseCase({ claim, claimId: "mongo-id" }, session);
  expect(saveEvents).toHaveBeenCalledWith(
    [
      {
        event: expect.objectContaining({
          type: "cloud.defra.local.fg-gas-backend.claim.submitted",
          data: expect.objectContaining({
            claims: [expect.objectContaining({ gasClaimId: "mongo-id" })],
          }),
        }),
        target: config.sns.updateCaseStatusTopicArn,
      },
    ],
    session,
  );
});
it("propagates failed outbox insertion to abort the transaction", async () => {
  saveEvents.mockRejectedValue(new Error("outbox unavailable"));
  await expect(
    storeClaimCaseUseCase({ claim, claimId: "mongo-id" }, {}),
  ).rejects.toThrow("outbox unavailable");
});
