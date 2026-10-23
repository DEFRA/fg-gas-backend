import { describe, expect, it } from "vitest";
import { GrantSettings } from "./grant-settings.js";

describe("grant settings", () => {
  it("serialises a new grant as closed", () => {
    expect(GrantSettings.closed("woodland").toDocument()).toEqual({
      grantCode: "woodland",
      open: false,
    });
  });
  it.each([undefined, null, "true", 1])(
    "rejects invalid status %j without opening the grant",
    (open) => {
      const settings = GrantSettings.closed("woodland");
      expect(() => settings.setOpen(open)).toThrow();
      expect(settings.isOpen()).toBe(false);
    },
  );
  it.each([
    null,
    {},
    { grantCode: "woodland" },
    { grantCode: "", open: true },
    { grantCode: "woodland", open: "false" },
  ])("rejects malformed stored settings %j", (document) => {
    expect(() => GrantSettings.fromDocument(document)).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 500 }),
      }),
    );
  });
  it("hydrates only the grant settings from a persisted document", () => {
    const settings = GrantSettings.fromDocument({
      _id: "ignored",
      grantCode: "woodland",
      open: true,
    });
    expect(settings.isOpen()).toBe(true);
    expect(settings.toDocument()).toEqual({
      grantCode: "woodland",
      open: true,
    });
  });
});
