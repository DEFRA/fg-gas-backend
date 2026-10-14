import { describe, expect, it } from "vitest";
import { GrantAllowList } from "./grant-allow-list.js";

const validGlobal = {
  sbi: ["900000002", "106000041"],
  crn: ["9000000001", "9000000002"],
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
        sbi: [" 900000002 ", "", "   ", "106000041"],
        crn: ["\t9000000001\n", "  ", "9000000002"],
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
          global: { sbi: ["900000002", " 900000002 "], crn: [] },
        }),
      { sbi: { invalid: [], duplicate: ["900000002"] }, crn: clean },
    );
  });

  it("reports duplicate CRNs after trimming", () => {
    expectValidationFailure(
      () =>
        new GrantAllowList({
          grantCode: "woodland",
          global: { sbi: [], crn: ["9000000001", " 9000000001 "] },
        }),
      { sbi: clean, crn: { invalid: [], duplicate: ["9000000001"] } },
    );
  });

  it("reports every problem across both lists in one response", () => {
    expectValidationFailure(
      () =>
        new GrantAllowList({
          grantCode: "woodland",
          global: {
            sbi: ["bad", "bad", "900000002"],
            crn: ["not-a-crn", "9000000001", "9000000001"],
          },
        }),
      {
        sbi: { invalid: ["bad"], duplicate: ["bad"] },
        crn: { invalid: ["not-a-crn"], duplicate: ["9000000001"] },
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
          sbi: ["900000004"],
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

  describe.each(["sbi", "crn"])("malformed %s collections", (kind) => {
    it.each([undefined, null, "9000000001", {}])(
      "refuses %j without changing the existing allow list",
      (values) => {
        const allowList = new GrantAllowList({
          grantCode: "woodland",
          global: validGlobal,
        });

        expect(() =>
          allowList.replaceGlobal({ ...validGlobal, [kind]: values }),
        ).toThrow(
          expect.objectContaining({
            output: expect.objectContaining({
              statusCode: 400,
              payload: expect.objectContaining({
                errorCode: "ALLOW_LIST_VALIDATION_FAILED",
              }),
            }),
          }),
        );
        expect(allowList.toJSON()).toEqual({
          grantCode: "woodland",
          global: validGlobal,
        });
      },
    );
  });

  it.each([undefined, null, {}])(
    "refuses missing global collections (%j) without changing the allow list",
    (global) => {
      const allowList = new GrantAllowList({
        grantCode: "woodland",
        global: validGlobal,
      });

      expect(() => allowList.replaceGlobal(global)).toThrow(
        expect.objectContaining({
          output: expect.objectContaining({
            statusCode: 400,
            payload: expect.objectContaining({
              errorCode: "ALLOW_LIST_VALIDATION_FAILED",
            }),
          }),
        }),
      );
      expect(allowList.toJSON()).toEqual({
        grantCode: "woodland",
        global: validGlobal,
      });
    },
  );

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
