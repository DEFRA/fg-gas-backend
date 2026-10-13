import { describe, expect, it } from "vitest";
import { GrantAllowList } from "./grant-allow-list.js";

const validGlobal = {
  sbi: ["106000033", "106000041"],
  crn: ["1042000000", "1042000011"],
};

const expectValidationFailure = (run, details) => {
  expect(run).toThrow(
    expect.objectContaining({
      isBoom: true,
      output: expect.objectContaining({
        statusCode: 400,
        payload: expect.objectContaining({
          errorCode: "ALLOW_LIST_VALIDATION_FAILED",
          details,
        }),
      }),
    }),
  );
};

const clean = { invalid: [], duplicate: [] };

describe("GrantAllowList", () => {
  it("refuses missing stored state instead of treating it as unrestricted", () => {
    expect(() => new GrantAllowList({ grantCode: "woodland" })).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 500,
          payload: expect.objectContaining({
            errorCode: "MALFORMED_ALLOW_LIST",
          }),
        }),
      }),
    );
  });

  it("creates an unrestricted allow list with ordered empty collections", () => {
    const allowList = GrantAllowList.unrestricted("woodland");

    expect(allowList.toJSON()).toEqual({
      grantCode: "woodland",
      global: { sbi: [], crn: [] },
    });
  });

  it("normalises surrounding whitespace and omits blank values", () => {
    const allowList = new GrantAllowList({
      grantCode: "woodland",
      global: {
        sbi: [" 106000033 ", "", "   ", "106000041"],
        crn: ["\t1042000000\n", "  ", "1042000011"],
      },
    });

    expect(allowList.toJSON().global).toEqual(validGlobal);
  });

  it("accepts valid identifiers while preserving their submitted order", () => {
    const allowList = new GrantAllowList({
      grantCode: "woodland",
      global: validGlobal,
    });

    expect(allowList.toJSON().global).toEqual(validGlobal);
  });

  it.each(["10600003", "1060000333", "10600A033"])(
    "reports an SBI that is not exactly 9 decimal digits: %s",
    (sbi) => {
      expectValidationFailure(
        () =>
          new GrantAllowList({
            grantCode: "woodland",
            global: { sbi: [sbi], crn: [] },
          }),
        { sbi: { invalid: [sbi], duplicate: [] }, crn: clean },
      );
    },
  );

  it.each(["104200000", "10420000000", "10420A0000"])(
    "reports a CRN that is not exactly 10 decimal digits: %s",
    (crn) => {
      expectValidationFailure(
        () =>
          new GrantAllowList({
            grantCode: "woodland",
            global: { sbi: [], crn: [crn] },
          }),
        { sbi: clean, crn: { invalid: [crn], duplicate: [] } },
      );
    },
  );

  it("reports duplicate SBIs after trimming", () => {
    expectValidationFailure(
      () =>
        new GrantAllowList({
          grantCode: "woodland",
          global: { sbi: ["106000033", " 106000033 "], crn: [] },
        }),
      { sbi: { invalid: [], duplicate: ["106000033"] }, crn: clean },
    );
  });

  it("reports duplicate CRNs after trimming", () => {
    expectValidationFailure(
      () =>
        new GrantAllowList({
          grantCode: "woodland",
          global: { sbi: [], crn: ["1042000000", " 1042000000 "] },
        }),
      { sbi: clean, crn: { invalid: [], duplicate: ["1042000000"] } },
    );
  });

  it("reports every problem across both lists in one response", () => {
    expectValidationFailure(
      () =>
        new GrantAllowList({
          grantCode: "woodland",
          global: {
            sbi: ["bad", "bad", "106000033"],
            crn: ["not-a-crn", "1042000000", "1042000000"],
          },
        }),
      {
        sbi: { invalid: ["bad"], duplicate: ["bad"] },
        crn: { invalid: ["not-a-crn"], duplicate: ["1042000000"] },
      },
    );
  });

  it("leaves both collections unchanged when either replacement is invalid", () => {
    const allowList = new GrantAllowList({
      grantCode: "woodland",
      global: validGlobal,
    });

    expectValidationFailure(
      () =>
        allowList.replaceGlobal({
          sbi: ["106000099"],
          crn: ["not-a-crn"],
        }),
      { sbi: clean, crn: { invalid: ["not-a-crn"], duplicate: [] } },
    );
    expect(allowList.toJSON().global).toEqual(validGlobal);
  });

  it("replaces both populated collections with empty collections", () => {
    const allowList = new GrantAllowList({
      grantCode: "woodland",
      global: validGlobal,
    });

    allowList.replaceGlobal({ sbi: [], crn: [] });

    expect(allowList.toJSON().global).toEqual({ sbi: [], crn: [] });
  });

  it("serialises only the grant code and global identifier collections", () => {
    const allowList = new GrantAllowList({
      grantCode: "woodland",
      global: validGlobal,
    });

    expect(allowList.toDocument()).toEqual({
      grantCode: "woodland",
      global: validGlobal,
    });
    expect(allowList.toDocument()).not.toHaveProperty("windows");
    expect(allowList.toDocument()).not.toHaveProperty("_id");
  });
});
