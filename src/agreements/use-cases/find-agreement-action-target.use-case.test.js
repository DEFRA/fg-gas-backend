import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import { findAgreementWithLatestVersionByExternalItemIdentity } from "../repositories/agreement.repository.js";
import { findAgreementActionTarget } from "./find-agreement-action-target.use-case.js";

vi.mock("../repositories/agreement.repository.js");

describe("find Agreement action target", () => {
  const agreement = Agreement.fromDocument({
    _id: "agreement-id",
    agreementNumber: "PMF000000001",
    sbi: "123456789",
    items: [
      {
        agreementItemId: "agreement-item-id",
        agreementCode: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        status: "stale-wrapper-status",
      },
    ],
  });
  const version = new AgreementVersion({
    _id: "version-2",
    agreementId: "agreement-id",
    agreementNumber: "PMF000000001",
    sbi: "123456789",
    version: 2,
    createdAt: "2026-06-01T10:00:00.000Z",
    change: {
      type: "accepted",
      changedBy: "applicant",
      fromStatus: "offered",
    },
    snapshot: {
      _id: "agreement-id",
      agreementNumber: "PMF000000001",
      sbi: "123456789",
      items: [
        {
          agreementItemId: "agreement-item-id",
          status: "accepted",
        },
      ],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds the Agreement item and current item state from the latest Agreement version", async () => {
    findAgreementWithLatestVersionByExternalItemIdentity.mockResolvedValue({
      agreement,
      version,
    });

    await expect(
      findAgreementActionTarget(
        {
          agreementNumber: "PMF000000001",
          clientRef: "PMF-APP-001",
          code: "pigs-might-fly",
        },
        "session",
      ),
    ).resolves.toEqual({
      agreement,
      item: agreement.items[0],
      previousItemState: {
        agreementItemId: "agreement-item-id",
        status: "accepted",
      },
      previousVersion: version,
    });
    expect(
      findAgreementWithLatestVersionByExternalItemIdentity,
    ).toHaveBeenCalledWith(
      {
        agreementNumber: "PMF000000001",
        agreementCode: "pigs-might-fly",
        clientRef: "PMF-APP-001",
      },
      "session",
    );
  });

  it("rejects when the Agreement item can not be found", async () => {
    findAgreementWithLatestVersionByExternalItemIdentity.mockResolvedValue(
      null,
    );

    await expect(
      findAgreementActionTarget(
        {
          agreementNumber: "PMF000000001",
          clientRef: "PMF-APP-001",
          code: "pigs-might-fly",
        },
        "session",
      ),
    ).rejects.toThrow("Agreement item not found");
  });

  it("rejects when the latest Agreement version can not be found", async () => {
    findAgreementWithLatestVersionByExternalItemIdentity.mockResolvedValue({
      agreement,
      version: null,
    });

    await expect(
      findAgreementActionTarget(
        {
          agreementNumber: "PMF000000001",
          clientRef: "PMF-APP-001",
          code: "pigs-might-fly",
        },
        "session",
      ),
    ).rejects.toThrow("Agreement version not found");
  });

  it("rejects when the latest Agreement version has no item state", async () => {
    const versionWithoutItemState = new AgreementVersion({
      ...version.toDocument(),
      snapshot: {
        ...version.snapshot,
        items: [],
      },
    });
    findAgreementWithLatestVersionByExternalItemIdentity.mockResolvedValue({
      agreement,
      version: versionWithoutItemState,
    });

    await expect(
      findAgreementActionTarget(
        {
          agreementNumber: "PMF000000001",
          clientRef: "PMF-APP-001",
          code: "pigs-might-fly",
        },
        "session",
      ),
    ).rejects.toThrow("Agreement item state not found");
  });
});
