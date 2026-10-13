import { describe, expect, test } from "vitest";
import { buildAllowListView, parseAllowListForm } from "./build-allow-list-view.js";

const persisted = {
  grantCode: "woodland",
  global: {
    sbi: ["106000033"],
    crn: ["1042000000"],
  },
};

const clean = { invalid: [], duplicate: [] };

describe("parseAllowListForm", () => {
  test("normalises line endings, whitespace and blank lines", () => {
    expect(
      parseAllowListForm({
        sbi: " 106000033\r\n\r106000044 \n\n",
        crn: " 1042000000\r1042000011\r\n ",
      }).global,
    ).toEqual({
      sbi: ["106000033", "106000044"],
      crn: ["1042000000", "1042000011"],
    });
  });

  test("accepts empty fields as an unrestricted allow list", () => {
    expect(parseAllowListForm({ sbi: "", crn: " \n\r\n " }).global).toEqual({
      sbi: [],
      crn: [],
    });
  });

  test("never refuses input itself - GAS's domain model is the sole judge of validity", () => {
    expect(
      parseAllowListForm({ sbi: "bad", crn: "also bad" }).global,
    ).toEqual({
      sbi: ["bad"],
      crn: ["also bad"],
    });
  });
});

describe("buildAllowListView", () => {
  test("shows persisted identifiers one per line with singular counts", () => {
    expect(buildAllowListView({ allowList: persisted })).toEqual({
      sbi: {
        key: "sbi",
        label: "Single Business Identifiers (SBIs)",
        value: "106000033",
        hint: "One per line. 1 listed.",
        error: undefined,
      },
      crn: {
        key: "crn",
        label: "Customer Reference Numbers (CRNs)",
        value: "1042000000",
        hint: "One per line. 1 listed.",
        error: undefined,
      },
      errorSummary: [],
    });
  });

  test("shows zero counts for an unrestricted allow list", () => {
    const view = buildAllowListView({
      allowList: { grantCode: "woodland", global: { sbi: [], crn: [] } },
    });

    expect(view.sbi.hint).toBe("One per line. 0 listed.");
    expect(view.crn.hint).toBe("One per line. 0 listed.");
  });

  test.each([
    ["sbi", "10600003", 'SBI "10600003" on line 1 must be exactly 9 digits'],
    [
      "sbi",
      "10600003x",
      'SBI "10600003x" on line 1 must be exactly 9 digits',
    ],
    [
      "crn",
      "104200000",
      'CRN "104200000" on line 1 must be exactly 10 digits',
    ],
    [
      "crn",
      "104200000x",
      'CRN "104200000x" on line 1 must be exactly 10 digits',
    ],
  ])("reports a %s GAS flagged as invalid", (key, value, message) => {
    const submitted = { sbi: "", crn: "", [key]: value };
    const details = {
      sbi: clean,
      crn: clean,
      [key]: { invalid: [value], duplicate: [] },
    };

    const view = buildAllowListView({ allowList: persisted, submitted, details });

    expect(view[key].error).toBe(message);
    expect(view.errorSummary).toEqual([
      { text: message, href: `#${key}`, attributes: { "data-error-line": 1 } },
    ]);
  });

  test.each([
    [
      "sbi",
      "106000033\n 106000033 ",
      'SBI "106000033" on line 2 is a duplicate of line 1',
    ],
    [
      "crn",
      "1042000000\r\n1042000000",
      'CRN "1042000000" on line 2 is a duplicate of line 1',
    ],
  ])(
    "reports a %s GAS flagged as a duplicate after trimming",
    (key, value, message) => {
      const submitted = { sbi: "", crn: "", [key]: value };
      const trimmedValue = value.split(/\r\n|\r|\n/)[0].trim();
      const details = {
        sbi: clean,
        crn: clean,
        [key]: { invalid: [], duplicate: [trimmedValue] },
      };

      const view = buildAllowListView({
        allowList: persisted,
        submitted,
        details,
      });

      expect(view[key].error).toBe(message);
    },
  );

  test("uses visible line numbers including blank lines", () => {
    const submitted = { sbi: "\n  106000033  \r\n\r106000033", crn: "" };
    const details = {
      sbi: { invalid: [], duplicate: ["106000033"] },
      crn: clean,
    };

    const view = buildAllowListView({ allowList: persisted, submitted, details });

    expect(view.errorSummary).toEqual([
      {
        text: 'SBI "106000033" on line 4 is a duplicate of line 2',
        href: "#sbi",
        attributes: { "data-error-line": 4 },
      },
    ]);
  });

  test("reports both fields in SBI then CRN order", () => {
    const submitted = { sbi: "bad", crn: "also bad" };
    const details = {
      sbi: { invalid: ["bad"], duplicate: [] },
      crn: { invalid: ["also bad"], duplicate: [] },
    };

    const view = buildAllowListView({ allowList: persisted, submitted, details });

    expect(view.errorSummary.map(({ text }) => text)).toEqual([
      'SBI "bad" on line 1 must be exactly 9 digits',
      'CRN "also bad" on line 1 must be exactly 10 digits',
    ]);
  });

  test("preserves submitted text and counts every nonblank line", () => {
    const submitted = {
      sbi: " 106000033\r\n\r\n106000033 ",
      crn: "bad\rvalue\n",
    };
    const details = {
      sbi: { invalid: [], duplicate: ["106000033"] },
      crn: { invalid: ["bad", "value"], duplicate: [] },
    };

    const view = buildAllowListView({ allowList: persisted, submitted, details });

    expect(view.sbi.value).toBe(submitted.sbi);
    expect(view.sbi.hint).toBe("One per line. 2 listed.");
    expect(view.crn.value).toBe(submitted.crn);
    expect(view.crn.hint).toBe("One per line. 2 listed.");
  });
});
