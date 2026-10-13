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
  describe("eligibility", () => {
    it.each([
      [[], [], "106000099", "1042000099", true],
      [[], [], "", "", true],
      [["106000033"], [], "106000033", "", true],
      [["106000033"], [], "106000099", "1042000000", false],
      [["106000033"], [], "", "1042000000", false],
      [[], ["1042000000"], "", "1042000000", true],
      [[], ["1042000000"], "106000033", "1042000099", false],
      [[], ["1042000000"], "106000033", "", false],
      [["106000033"], ["1042000000"], "106000033", "1042000000", true],
      [["106000033"], ["1042000000"], "106000099", "1042000000", false],
      [["106000033"], ["1042000000"], "106000033", "1042000099", false],
      [["106000033"], ["1042000000"], "106000099", "1042000099", false],
      [["106000033"], ["1042000000"], "", "1042000000", false],
      [["106000033"], ["1042000000"], "106000033", "", false],
      [["106000033"], ["1042000000"], "", "", false],
      [["000000001"], ["0000000001"], "000000001", "0000000001", true],
    ])(
      "applies both restrictions %j / %j to %s / %s: %s",
      (sbis, crns, sbi, crn, allowed) => {
        const list = new GrantAllowList({
          grantCode: "woodland",
          global: { sbi: sbis, crn: crns },
        });
        expect(list.allows({ sbi, crn })).toBe(allowed);
      },
    );
  });

  describe("assembly for a known grant", () => {
    const assemble = (grantIdentity, storedList = null) =>
      GrantAllowList.forGrant({
        grantCode: "woodland",
        grantIdentity,
        storedList,
      });

    it("defaults only a known grant without a stored list to unrestricted", () => {
      expect(
        assemble({ grantCode: "woodland" }).allows({ sbi: "", crn: "" }),
      ).toBe(true);
    });

    it("preserves an existing grant's restrictions", () => {
      const list = new GrantAllowList({
        grantCode: "woodland",
        global: validGlobal,
      });
      expect(assemble({ grantCode: "woodland" }, list).toJSON()).toEqual({
        grantCode: "woodland",
        global: validGlobal,
      });
      expect(
        assemble({ grantCode: "woodland" }, list).allows({
          sbi: "106000099",
          crn: "1042000000",
        }),
      ).toBe(false);
    });

    it.each([null, GrantAllowList.unrestricted("woodland")])(
      "rejects an unknown grant even with orphan state %j",
      (list) => {
        expect(() => assemble(null, list)).toThrow(
          expect.objectContaining({
            output: expect.objectContaining({ statusCode: 404 }),
          }),
        );
      },
    );

    it.each([
      [{ grantCode: "other" }, null],
      [{ grantCode: "woodland" }, GrantAllowList.unrestricted("other")],
    ])("rejects mismatched grant ownership %j / %j", (identity, list) => {
      expect(() => assemble(identity, list)).toThrow(
        expect.objectContaining({
          output: expect.objectContaining({ statusCode: 500 }),
        }),
      );
    });
  });

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

  describe.each(["sbi", "crn"])("malformed %s collections", (kind) => {
    it.each([undefined, null, "1042000000", {}])(
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
