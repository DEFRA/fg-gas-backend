import { expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { saveEvents } from "../../events/index.js";
import { Claim } from "../models/claim.js";
import { storeClaimCaseUseCase } from "./store-claim-case.use-case.js";
vi.mock("../../events/index.js");
const grant = {
  claims: { onClaimSubmission: { processes: ["STORE_CLAIM_CASE"] } },
};
const savedClaim = (amount = 150000, details = {}) =>
  Claim.create({
    code: "woodland",
    clientRef: "wmp-6hb-j8e",
    claimCode: "ENT_CS_CAPITAL_PA3",
    clientClaimRef: "WMP-6HB-J8E-C0001",
    createdAt: "2026-08-07T11:16:05.745Z",
    metadata: {
      clientRef: "wmp-6hb-j8e",
      grantCode: "woodland",
      sbi: "113593357",
      submittedAt: "2026-08-01T00:00:00.000Z",
      privateField: "omit",
    },
    claim: {
      entitlementId: "ent-1",
      totalClaimAmountPence: amount,
      quantity: 1,
      additionalAnswers: { reference: "plan-123" },
      ...details,
    },
  });
it.each([150000, 0])(
  "maps saved claim facts into a generic case update for amount %s",
  async (amount) => {
    const session = { transaction: true };
    await storeClaimCaseUseCase(
      { grant, claim: savedClaim(amount), claimId: "mongo-id" },
      session,
    );
    expect(saveEvents).toHaveBeenCalledWith(
      [
        {
          event: expect.objectContaining({
            type: "cloud.defra.local.fg-gas-backend.case.update.supplementary.data",
            data: {
              caseRef: "wmp-6hb-j8e",
              workflowCode: "woodland",
              supplementaryData: {
                targetNode: "claims",
                dataType: "ARRAY",
                key: "gasClaimId",
                data: {
                  entitlementId: "ent-1",
                  quantity: 1,
                  additionalAnswers: { reference: "plan-123" },
                  gasClaimId: "mongo-id",
                  clientClaimRef: "WMP-6HB-J8E-C0001",
                  claimCode: "ENT_CS_CAPITAL_PA3",
                  claimAmountPence: amount,
                  sbi: "113593357",
                  status: "SUBMITTED",
                  submittedAt: "2026-08-07T11:16:05.745Z",
                },
              },
            },
          }),
          target: config.sns.updateCaseStatusTopicArn,
        },
      ],
      session,
    );
  },
);
it("keeps saved GAS facts authoritative when claim details use the same names", async () => {
  await storeClaimCaseUseCase(
    {
      grant,
      claim: savedClaim(150000, {
        gasClaimId: "caller-id",
        clientClaimRef: "caller-reference",
        claimCode: "caller-code",
        claimAmountPence: 1,
        sbi: "caller-sbi",
        status: "caller-status",
        submittedAt: "caller-date",
      }),
      claimId: "mongo-id",
    },
    {},
  );
  const record =
    saveEvents.mock.calls[0][0][0].event.data.supplementaryData.data;
  expect(record).toEqual({
    entitlementId: "ent-1",
    quantity: 1,
    additionalAnswers: { reference: "plan-123" },
    gasClaimId: "mongo-id",
    clientClaimRef: "WMP-6HB-J8E-C0001",
    claimCode: "ENT_CS_CAPITAL_PA3",
    claimAmountPence: 150000,
    sbi: "113593357",
    status: "SUBMITTED",
    submittedAt: "2026-08-07T11:16:05.745Z",
  });
});
it("propagates failed outbox insertion to abort the transaction", async () => {
  saveEvents.mockRejectedValue(new Error("outbox unavailable"));
  await expect(
    storeClaimCaseUseCase(
      { grant, claim: savedClaim(), claimId: "mongo-id" },
      {},
    ),
  ).rejects.toThrow("outbox unavailable");
});
it.each([
  {},
  { claims: {} },
  { claims: { onClaimSubmission: { processes: [] } } },
])("does not queue unconfigured delivery: %j", async (unconfiguredGrant) => {
  await storeClaimCaseUseCase(
    { grant: unconfiguredGrant, claim: savedClaim(), claimId: "mongo-id" },
    {},
  );
  expect(saveEvents).not.toHaveBeenCalled();
});
