import { describe, expect, it } from "vitest";
import { GrantAdminAccess } from "./grant-admin-access.js";

describe("GrantAdminAccess", () => {
  it("allows the configured role among the user's caseworking roles", () => {
    expect(() =>
      new GrantAdminAccess({ role: "ROLE_WOODLAND_ADMIN" }).assertAccess([
        "OTHER",
        "ROLE_WOODLAND_ADMIN",
      ]),
    ).not.toThrow();
  });

  it.each([undefined, null, {}, { role: "" }, { role: " " }])(
    "denies access when the admin role is missing: %j",
    (admin) => {
      expect(() =>
        new GrantAdminAccess(admin).assertAccess(["ROLE_WOODLAND_ADMIN"]),
      ).toThrow(
        expect.objectContaining({
          output: expect.objectContaining({ statusCode: 403 }),
        }),
      );
    },
  );

  it.each([undefined, null, [], ["ROLE_WOODLAND_READER"]])(
    "denies access when the user does not hold the role: %j",
    (roles) => {
      expect(() =>
        new GrantAdminAccess({ role: "ROLE_WOODLAND_ADMIN" }).assertAccess(
          roles,
        ),
      ).toThrow(
        expect.objectContaining({
          output: expect.objectContaining({ statusCode: 403 }),
        }),
      );
    },
  );
});
