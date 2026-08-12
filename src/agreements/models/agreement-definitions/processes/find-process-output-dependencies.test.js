import { describe, expect, it } from "vitest";
import { findProcessOutputDependencies } from "./find-process-output-dependencies.js";

describe("findProcessOutputDependencies", () => {
  it("finds and deduplicates static output dependencies in nested mappings", () => {
    const definition = {
      request: {
        body: {
          amount: "$.outputs.calculate.totalAmountPence",
          duplicate: "$.outputs.calculate.totalAmountPence",
        },
      },
      input: {
        actions: 'jsonata:$lookup($.outputs, "load-actions").actions',
      },
      output: {
        copiedProcessOutput: "$.outputs.calculate",
        literal: "$.agreement.totalAmountPence",
      },
    };

    expect(findProcessOutputDependencies(definition)).toEqual([
      { processKey: "calculate", outputName: "totalAmountPence" },
      { processKey: "load-actions", outputName: "actions" },
      { processKey: "calculate", outputName: undefined },
    ]);
  });

  it("returns no dependencies when mappings do not access outputs", () => {
    expect(
      findProcessOutputDependencies({
        request: { body: { value: "literal" } },
        input: null,
        output: { amount: 10 },
      }),
    ).toEqual([]);
  });

  it.each([
    [
      "computed output keys",
      "jsonata:$.outputs[$.execution.target]",
      /static key/,
    ],
    [
      "dynamic lookups",
      "jsonata:$lookup($.outputs, $.execution.target)",
      /Dynamic .* lookup/,
    ],
    [
      "indirect output roots",
      'jsonata:$lookup($lookup($, "outputs"), "calculate")',
      /lookup must target \$\.outputs/,
    ],
    [
      "output access hidden in strings",
      'jsonata:$eval("$.outputs.calculate")',
      /cannot be hidden in a string/,
    ],
  ])("rejects %s", (_name, mapping, expected) => {
    expect(() =>
      findProcessOutputDependencies({ input: { value: mapping } }),
    ).toThrow(expected);
  });
});
