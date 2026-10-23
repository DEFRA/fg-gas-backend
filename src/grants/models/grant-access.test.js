import { describe, expect, it } from "vitest";
import { GrantAllowList } from "./grant-allow-list.js";

describe("grant access", () => {
  it("denies access when settings do not exist, even without identifier restrictions", async () => {
    const { GrantAccess } = await import("./grant-access.js");
    const access = new GrantAccess({
      allowList: GrantAllowList.unrestricted("woodland"),
    });
    expect(access.allows({ sbi: "106000033", crn: "1042000000" })).toBe(false);
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
    expect(access.allows({ sbi: "106000033", crn: "1042000000" })).toBe(true);
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
      global: { sbi: ["106000033"], crn: ["1042000000"] },
    });
    const access = new GrantAccess({ settings, allowList });
    const applicant = { sbi: "106000033", crn: "1042000000" };
    settings.setOpen(true);
    expect(access.allows(applicant)).toBe(true);
    expect(access.allows({ ...applicant, sbi: "106000099" })).toBe(false);
    expect(access.allows({ ...applicant, crn: "1042000099" })).toBe(false);
    settings.setOpen(false);
    expect(access.allows(applicant)).toBe(false);
    settings.setOpen(true);
    expect(access.allows(applicant)).toBe(true);
  });
});
