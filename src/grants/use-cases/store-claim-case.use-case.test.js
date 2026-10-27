import { expect, it, vi } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { config } from "../../common/config.js";
import { saveEvents } from "../../events/index.js";
import { Claim } from "../models/claim.js";
import { storeClaimCaseUseCase } from "./store-claim-case.use-case.js";
vi.mock("../../events/index.js");
const grantWithUnit = (unit = "HA") =>
  createTestGrant({
    entitlementTemplates: [
      {
        claimCode: "ENT_CS_CAPITAL_PA3",
        name: "Woodland entitlement",
        materialised: true,
        maxEntitlements: 1,
        availableAt: [
          {
            phase: "PRE_AWARD",
            stage: "ASSESSMENT",
            status: "APPLICATION_RECEIVED",
          },
        ],
        fields: unit
          ? {
              area: {
                input: true,
                label: "Area",
                unitType: "decimal",
                decimalPlaces: 2,
                unit,
              },
            }
          : undefined,
      },
    ],
  });
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
      sbi: "900000007",
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
      {
        claim: savedClaim(amount),
        claimId: "mongo-id",
        grant: grantWithUnit(),
      },
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
                  unit: "HA",
                  additionalAnswers: { reference: "plan-123" },
                  gasClaimId: "mongo-id",
                  clientClaimRef: "WMP-6HB-J8E-C0001",
                  claimCode: "ENT_CS_CAPITAL_PA3",
                  claimAmountPence: amount,
                  sbi: "900000007",
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
      claim: savedClaim(150000, {
        unit: "acres",
        gasClaimId: "caller-id",
        clientClaimRef: "caller-reference",
        claimCode: "caller-code",
        claimAmountPence: 1,
        sbi: "caller-sbi",
        status: "caller-status",
        submittedAt: "caller-date",
      }),
      claimId: "mongo-id",
      grant: grantWithUnit(),
    },
    {},
  );
  const record =
    saveEvents.mock.calls[0][0][0].event.data.supplementaryData.data;
  expect(record).toEqual({
    entitlementId: "ent-1",
    quantity: 1,
    unit: "HA",
    additionalAnswers: { reference: "plan-123" },
    gasClaimId: "mongo-id",
    clientClaimRef: "WMP-6HB-J8E-C0001",
    claimCode: "ENT_CS_CAPITAL_PA3",
    claimAmountPence: 150000,
    sbi: "900000007",
    status: "SUBMITTED",
    submittedAt: "2026-08-07T11:16:05.745Z",
  });
});
it("propagates failed outbox insertion to abort the transaction", async () => {
  saveEvents.mockRejectedValue(new Error("outbox unavailable"));
  await expect(
    storeClaimCaseUseCase(
      { claim: savedClaim(), claimId: "mongo-id", grant: grantWithUnit() },
      {},
    ),
  ).rejects.toThrow("outbox unavailable");
});

it("leaves the unit unset when the template measures nothing", async () => {
  await storeClaimCaseUseCase(
    { claim: savedClaim(), claimId: "mongo-id", grant: grantWithUnit(null) },
    {},
  );
  const record =
    saveEvents.mock.calls[0][0][0].event.data.supplementaryData.data;
  expect(record.quantity).toBe(1);
  expect(record.unit).toBeNull();
});

it.each(["HA", "M"])(
  "takes unit %s from the template independently of quantity",
  async (unit) => {
    await storeClaimCaseUseCase(
      {
        claim: savedClaim(150000, { quantity: undefined }),
        claimId: "mongo-id",
        grant: grantWithUnit(unit),
      },
      {},
    );
    const record =
      saveEvents.mock.calls[0][0][0].event.data.supplementaryData.data;
    expect(record.quantity).toBeUndefined();
    expect(record.unit).toBe(unit);
  },
);
