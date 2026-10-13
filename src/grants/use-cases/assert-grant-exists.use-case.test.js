import { describe, expect, it, vi } from "vitest";
import { existsByGrantCode } from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { assertGrantExists } from "./assert-grant-exists.use-case.js";

vi.mock("../repositories/config-version.repository.js");
vi.mock("../repositories/grant.repository.js");

describe("assertGrantExists", () => {
  it("accepts a grant in the legacy store", async () => {
    findByCode.mockResolvedValue({ code: "woodland" });

    await expect(assertGrantExists("woodland")).resolves.toBeUndefined();
    expect(existsByGrantCode).not.toHaveBeenCalled();
  });

  it("accepts a grant known only by configuration versions", async () => {
    findByCode.mockResolvedValue(null);
    existsByGrantCode.mockResolvedValue(true);

    await expect(assertGrantExists("woodland")).resolves.toBeUndefined();
    expect(existsByGrantCode).toHaveBeenCalledWith("woodland");
  });

  it("uses the active session for both existence sources", async () => {
    const session = {};
    findByCode.mockResolvedValue(null);
    existsByGrantCode.mockResolvedValue(true);

    await assertGrantExists("woodland", session);

    expect(findByCode).toHaveBeenCalledWith("woodland", "0.0.0", session);
    expect(existsByGrantCode).toHaveBeenCalledWith("woodland", session);
  });

  it("accepts a grant present in both stores", async () => {
    findByCode.mockResolvedValue({ code: "woodland" });
    existsByGrantCode.mockResolvedValue(true);

    await expect(assertGrantExists("woodland")).resolves.toBeUndefined();
  });

  it("returns a 404 only when neither store knows the grant", async () => {
    findByCode.mockResolvedValue(null);
    existsByGrantCode.mockResolvedValue(false);

    await expect(assertGrantExists("missing")).rejects.toMatchObject({
      isBoom: true,
      output: {
        statusCode: 404,
        payload: expect.objectContaining({
          message: 'Grant with code "missing" not found',
        }),
      },
    });
  });

  it("propagates repository failures", async () => {
    const failure = new Error("database unavailable");
    findByCode.mockRejectedValue(failure);

    await expect(assertGrantExists("woodland")).rejects.toBe(failure);
  });

  it("propagates configuration-version repository failures", async () => {
    const failure = new Error("config versions unavailable");
    findByCode.mockResolvedValue(null);
    existsByGrantCode.mockRejectedValue(failure);

    await expect(assertGrantExists("woodland")).rejects.toBe(failure);
  });
});
