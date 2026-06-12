import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import {
  findAgreementBySourceIdentity,
  insertAgreementWithVersion,
} from "./agreement.repository.js";

vi.mock("../../common/mongo-client.js");

describe("agreement repository", () => {
  it("finds an Agreement by source identity", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValue({
        _id: "agreement-id",
        agreementNumber: "PMF000000001",
        sbi: "123456789",
        items: [
          {
            agreementItemId: "agreement-item-id",
            agreementCode: "pigs-might-fly",
            clientRef: "PMF-APP-001",
          },
        ],
      }),
    };
    db.collection.mockReturnValue(agreements);

    const result = await findAgreementBySourceIdentity(
      {
        agreementCode: "pigs-might-fly",
        clientRef: "PMF-APP-001",
      },
      "session",
    );

    expect(result.agreementNumber).toBe("PMF000000001");
    expect(agreements.findOne).toHaveBeenCalledWith(
      {
        items: {
          $elemMatch: {
            agreementCode: "pigs-might-fly",
            clientRef: "PMF-APP-001",
          },
        },
      },
      { session: "session" },
    );
  });

  it("inserts an Agreement wrapper and version without knowing the Creation result", async () => {
    const agreementsCollection = {
      insertOne: vi.fn(),
    };
    const agreementVersions = {
      insertOne: vi.fn(),
    };
    const agreement = Agreement.fromDocument({
      _id: "agreement-id",
      agreementNumber: "PMF000000001",
      sbi: "123456789",
      items: [],
    });
    const version = new AgreementVersion({
      _id: "version-id",
      agreementId: "agreement-id",
      version: 1,
      snapshot: {
        _id: "agreement-id",
        agreementNumber: "PMF000000001",
        sbi: "123456789",
        items: [],
      },
    });
    db.collection.mockImplementation((name) =>
      name === "agreement_versions" ? agreementVersions : agreementsCollection,
    );

    const result = await insertAgreementWithVersion(
      { agreement, version },
      "session",
    );

    expect(result).toBe(agreement);
    expect(agreementsCollection.insertOne).toHaveBeenCalledWith(
      agreement.toDocument(),
      { session: "session" },
    );
    expect(agreementVersions.insertOne).toHaveBeenCalledWith(
      version.toDocument(),
      { session: "session" },
    );
  });
});
