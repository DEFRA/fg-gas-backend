import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { findIdentityByCode } from "./grant-identity.repository.js";

vi.mock("../../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
}));

describe("findIdentityByCode", () => {
  let legacy;
  let catalogue;
  beforeEach(() => {
    legacy = { findOne: vi.fn().mockResolvedValue(null) };
    catalogue = { findOne: vi.fn().mockResolvedValue(null) };
    db.collection.mockImplementation(
      (name) => ({ grants: legacy, config_versions: catalogue })[name],
    );
  });

  it("recognises a legacy grant at any version using only its code", async () => {
    legacy.findOne.mockResolvedValue({ code: "woodland" });
    await expect(findIdentityByCode("woodland")).resolves.toEqual({
      grantCode: "woodland",
    });
    expect(legacy.findOne).toHaveBeenCalledWith(
      { code: "woodland" },
      { projection: { _id: 0, code: 1 } },
    );
    expect(catalogue.findOne).not.toHaveBeenCalled();
  });

  it("recognises a catalogue-only grant without active/open filters", async () => {
    catalogue.findOne.mockResolvedValue({ grantCode: "woodland" });
    await expect(findIdentityByCode("woodland")).resolves.toEqual({
      grantCode: "woodland",
    });
    expect(catalogue.findOne).toHaveBeenCalledWith(
      { grantCode: "woodland" },
      { projection: { _id: 0, grantCode: 1 } },
    );
  });

  it("returns absence when neither store knows the grant", async () => {
    await expect(findIdentityByCode("missing")).resolves.toBeNull();
  });

  it("does not turn a failed lookup into absence", async () => {
    legacy.findOne.mockRejectedValue(new Error("database unavailable"));
    await expect(findIdentityByCode("woodland")).rejects.toThrow(
      "database unavailable",
    );
  });
});
