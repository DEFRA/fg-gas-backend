import { describe, expect, it } from "vitest";
import { GrantAllowList } from "./grant-allow-list.js";

const validGlobal = {
  sbi: ["106000033", "106000041"],
  crn: ["1042000000", "1042000011"],
};

const expectRefusal = (run, errorCode) => {
  expect(run).toThrow(
    expect.objectContaining({
      isBoom: true,
      output: expect.objectContaining({
        statusCode: 400,
        payload: expect.objectContaining({ errorCode }),
      }),
    }),
  );
};

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
    "refuses an SBI that is not exactly 9 decimal digits: %s",
    (sbi) => {
      expectRefusal(
        () =>
          new GrantAllowList({
            grantCode: "woodland",
            global: { sbi: [sbi], crn: [] },
          }),
        "INVALID_ALLOW_LIST_IDENTIFIER",
      );
    },
  );

  it.each(["104200000", "10420000000", "10420A0000"])(
    "refuses a CRN that is not exactly 10 decimal digits: %s",
    (crn) => {
      expectRefusal(
        () =>
          new GrantAllowList({
            grantCode: "woodland",
            global: { sbi: [], crn: [crn] },
          }),
        "INVALID_ALLOW_LIST_IDENTIFIER",
      );
    },
  );

  it("refuses duplicate SBIs after trimming", () => {
    expectRefusal(
      () =>
        new GrantAllowList({
          grantCode: "woodland",
          global: { sbi: ["106000033", " 106000033 "], crn: [] },
        }),
      "DUPLICATE_ALLOW_LIST_IDENTIFIER",
    );
  });

  it("refuses duplicate CRNs after trimming", () => {
    expectRefusal(
      () =>
        new GrantAllowList({
          grantCode: "woodland",
          global: { sbi: [], crn: ["1042000000", " 1042000000 "] },
        }),
      "DUPLICATE_ALLOW_LIST_IDENTIFIER",
    );
  });

  it("leaves both collections unchanged when either replacement is invalid", () => {
    const allowList = new GrantAllowList({
      grantCode: "woodland",
      global: validGlobal,
    });

    expectRefusal(
      () =>
        allowList.replaceGlobal({
          sbi: ["106000099"],
          crn: ["not-a-crn"],
        }),
      "INVALID_ALLOW_LIST_IDENTIFIER",
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
