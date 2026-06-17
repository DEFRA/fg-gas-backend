import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementVersion } from "../models/agreement-version.js";
import { insertAgreementVersion } from "../repositories/agreement.repository.js";
import { recordAgreementItemTransition } from "./record-agreement-item-transition.use-case.js";

vi.mock("../repositories/agreement.repository.js");

describe("record Agreement item transition", () => {
  const previousVersion = new AgreementVersion({
    _id: "version-1",
    agreementId: "agreement-id",
    agreementNumber: "PMF000000001",
    version: 1,
    createdAt: "2026-06-01T09:00:00.000Z",
    snapshot: {
      _id: "agreement-id",
      agreementNumber: "PMF000000001",
      identifiers: {
        sbi: "123456789",
      },
      items: [
        {
          agreementItemId: "agreement-item-id",
          status: "offered",
        },
      ],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends the next immutable Agreement version for an Agreement item transition", async () => {
    const result = await recordAgreementItemTransition(
      {
        agreementItemId: "agreement-item-id",
        changedAt: "2026-06-01T10:00:00.000Z",
        createId: () => "version-2",
        fromStatus: "offered",
        itemPatch: {
          acceptedAt: "2026-06-01T10:00:00.000Z",
        },
        previousVersion,
        toStatus: "accepted",
      },
      "session",
    );

    expect(result.toDocument()).toEqual({
      _id: "version-2",
      agreementId: "agreement-id",
      agreementNumber: "PMF000000001",
      version: 2,
      createdAt: "2026-06-01T10:00:00.000Z",
      snapshot: {
        _id: "agreement-id",
        agreementNumber: "PMF000000001",
        identifiers: {
          sbi: "123456789",
        },
        updatedAt: "2026-06-01T10:00:00.000Z",
        items: [
          {
            agreementItemId: "agreement-item-id",
            acceptedAt: "2026-06-01T10:00:00.000Z",
            status: "accepted",
          },
        ],
      },
    });
    expect(insertAgreementVersion).toHaveBeenCalledWith(result, "session");
  });

  it("rejects a transition from the wrong Agreement item status", async () => {
    await expect(
      recordAgreementItemTransition(
        {
          agreementItemId: "agreement-item-id",
          changedAt: "2026-06-01T10:00:00.000Z",
          createId: () => "version-2",
          fromStatus: "accepted",
          previousVersion,
          toStatus: "accepted",
        },
        "session",
      ),
    ).rejects.toThrow("Agreement item is not accepted");

    expect(insertAgreementVersion).not.toHaveBeenCalled();
  });
});
