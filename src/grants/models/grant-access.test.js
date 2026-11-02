import { describe, expect, it } from "vitest";
import { GrantAllowList } from "./grant-allow-list.js";

describe("grant access", () => {
  it("denies access when settings do not exist, even without identifier restrictions", async () => {
    const { GrantAccess } = await import("./grant-access.js");
    const access = new GrantAccess({
      allowList: GrantAllowList.unrestricted("woodland"),
    });
    expect(access.allows({ sbi: "900000002", crn: "9000000001" })).toBe(false);
  });
  it("allows an open unrestricted grant", async () => {
    const { GrantAccess } = await import("./grant-access.js");
    const { GrantSettings } = await import("./grant-settings.js");
    const settings = GrantSettings.closed("woodland");
    settings.setOpen(true);
    const access = new GrantAccess({
      settings,
      allowList: GrantAllowList.unrestricted("woodland"),
    });
    expect(access.allows({ sbi: "900000002", crn: "9000000001" })).toBe(true);
  });
  it("rejects settings belonging to a different grant", async () => {
    const { GrantAccess } = await import("./grant-access.js");
    const { GrantSettings } = await import("./grant-settings.js");
    expect(
      () =>
        new GrantAccess({
          settings: GrantSettings.closed("other"),
          allowList: GrantAllowList.unrestricted("woodland"),
        }),
    ).toThrow();
  });
  it("retains both identifier restrictions across closing and reopening", async () => {
    const { GrantAccess } = await import("./grant-access.js");
    const { GrantSettings } = await import("./grant-settings.js");
    const settings = GrantSettings.closed("woodland");
    const allowList = new GrantAllowList({
      grantCode: "woodland",
      global: { sbi: ["900000002"], crn: ["9000000001"] },
    });
    const access = new GrantAccess({ settings, allowList });
    const applicant = { sbi: "900000002", crn: "9000000001" };
    settings.setOpen(true);
    expect(access.allows(applicant)).toBe(true);
    expect(access.allows({ ...applicant, sbi: "900000004" })).toBe(false);
    expect(access.allows({ ...applicant, crn: "9000000003" })).toBe(false);
    settings.setOpen(false);
    expect(access.allows(applicant)).toBe(false);
    settings.setOpen(true);
    expect(access.allows(applicant)).toBe(true);
  });
});

describe("business grant access", () => {
  it.each([
    [[], true, true],
    [["900000002"], true, true],
    [["900000004"], true, false],
    [["900000002"], false, false],
  ])(
    "decides using SBI and availability despite CRN restrictions: %j, open=%s",
    async (sbi, open, allowed) => {
      const { GrantAccess } = await import("./grant-access.js");
      const { GrantSettings } = await import("./grant-settings.js");
      const access = new GrantAccess({
        settings: new GrantSettings({ grantCode: "woodland", open }),
        allowList: new GrantAllowList({
          grantCode: "woodland",
          global: { sbi, crn: ["9000000001"] },
        }),
      });
      expect(access.allowsBusiness({ sbi: "900000002" })).toBe(allowed);
      expect(access.allows({ sbi: "900000002", crn: "9000000003" })).toBe(
        false,
      );
    },
  );
  it("denies business access when settings are missing", async () => {
    const { GrantAccess } = await import("./grant-access.js");
    const access = new GrantAccess({
      allowList: GrantAllowList.unrestricted("woodland"),
    });
    expect(access.allowsBusiness({ sbi: "900000002" })).toBe(false);
  });
});
