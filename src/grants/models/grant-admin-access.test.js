import { describe, expect, it } from "vitest";
import { GrantAdminAccess } from "./grant-admin-access.js";

const MISSING_ROLES = [undefined, null, {}, { role: "" }, { role: " " }];

const forbidden = expect.objectContaining({
  output: expect.objectContaining({ statusCode: 403 }),
});

describe("GrantAdminAccess", () => {
  it("allows the configured role among the user's caseworking roles", () => {
    expect(() =>
      new GrantAdminAccess({ role: "ROLE_WOODLAND_ADMIN" }).assertAccess([
        "OTHER",
        "ROLE_WOODLAND_ADMIN",
      ]),
    ).not.toThrow();
  });

  it("is configured when admin.role is named", () => {
    expect(() =>
      new GrantAdminAccess({ role: "ROLE_WOODLAND_ADMIN" }).assertConfigured(),
    ).not.toThrow();
  });

  it.each(MISSING_ROLES)(
    "refuses access, whatever the user holds, when the admin role is missing: %j",
    (admin) => {
      const access = new GrantAdminAccess(admin);

      expect(() => access.assertConfigured()).toThrow(forbidden);
      expect(() => access.assertAccess(["ROLE_WOODLAND_ADMIN"])).toThrow(
        forbidden,
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
      ).toThrow(forbidden);
    },
  );
});
