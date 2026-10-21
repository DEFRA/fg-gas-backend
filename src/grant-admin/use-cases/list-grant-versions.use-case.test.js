import { expect, it, vi } from "vitest";
import { findConfigVersions } from "../../grants/services/config-version.service.js";
import { listGrantVersionsUseCase } from "./list-grant-versions.use-case.js";

vi.mock("../../grants/services/config-version.service.js");

it("answers the grant's versions, newest first, naming the current one", async () => {
  const versions = {
    code: "woodland",
    current: "1.2.0",
    versions: [
      {
        version: "1.2.0",
        status: "active",
        receivedAt: "2026-10-10T16:25:00.000Z",
      },
    ],
  };
  findConfigVersions.mockResolvedValue(versions);

  expect(await listGrantVersionsUseCase({ code: "woodland" })).toEqual(
    versions,
  );
  expect(findConfigVersions).toHaveBeenCalledWith("woodland");
});

it("answers 404 GRANT_NOT_FOUND for a grant with no versions", async () => {
  findConfigVersions.mockResolvedValue(null);

  await expect(
    listGrantVersionsUseCase({ code: "woodland" }),
  ).rejects.toMatchObject({
    output: { statusCode: 404, payload: { reason: "GRANT_NOT_FOUND" } },
  });
});
