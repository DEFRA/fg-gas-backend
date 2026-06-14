import { describe, expect, it } from "vitest";
import {
  resolveActionValue,
  setActionOutput,
} from "./agreement-action-paths.js";

describe("Agreement action paths", () => {
  it("resolves nested objects and arrays from the Agreement action root", () => {
    const root = {
      action: {
        paymentDates: {
          agreementEndDate: "2027-06-30",
          agreementStartDate: "2026-07-01",
        },
      },
      command: {
        acceptedBy: "applicant",
      },
    };

    expect(
      resolveActionValue({
        root,
        value: {
          acceptedBy: "$.command.acceptedBy",
          payment: {
            dates: [
              "$.action.paymentDates.agreementStartDate",
              "$.action.paymentDates.agreementEndDate",
            ],
          },
        },
      }),
    ).toEqual({
      acceptedBy: "applicant",
      payment: {
        dates: ["2026-07-01", "2027-06-30"],
      },
    });
  });

  it("sets legacy path output by replacing a value", () => {
    const object = {
      payment: {
        agreementTotalPence: 10000,
      },
    };

    setActionOutput({
      object,
      output: {
        path: "payment",
        place: "replace",
      },
      value: {
        agreementTotalPence: 20000,
      },
    });

    expect(object.payment).toEqual({
      agreementTotalPence: 20000,
    });
  });

  it("appends target output to an array", () => {
    const object = {};

    setActionOutput({
      object,
      output: {
        target: {
          dataType: "ARRAY",
          place: "append",
          targetNode: "paymentPreparations",
        },
      },
      value: {
        code: "dates",
      },
    });

    expect(object.paymentPreparations).toEqual([{ code: "dates" }]);
  });

  it("replaces matching target array output by key", () => {
    const object = {
      paymentPreparations: [
        {
          code: "dates",
          result: "old",
        },
        {
          code: "schedule",
          result: "kept",
        },
      ],
    };

    setActionOutput({
      object,
      output: {
        target: {
          dataType: "ARRAY",
          key: "code",
          place: "append",
          targetNode: "paymentPreparations",
        },
      },
      value: {
        code: "dates",
        result: "new",
      },
    });

    expect(object.paymentPreparations).toEqual([
      {
        code: "dates",
        result: "new",
      },
      {
        code: "schedule",
        result: "kept",
      },
    ]);
  });

  it("upserts target object output by key", () => {
    const object = {
      paymentPreparations: {
        dates: {
          code: "dates",
          result: "old",
        },
      },
    };

    setActionOutput({
      object,
      output: {
        target: {
          dataType: "OBJECT",
          key: "code",
          place: "append",
          targetNode: "paymentPreparations",
        },
      },
      value: {
        code: "dates",
        result: "new",
      },
    });

    expect(object.paymentPreparations).toEqual({
      dates: {
        code: "dates",
        result: "new",
      },
    });
  });

  it("rejects object target output without a key", () => {
    expect(() =>
      setActionOutput({
        object: {},
        output: {
          target: {
            dataType: "OBJECT",
            place: "append",
            targetNode: "paymentPreparations",
          },
        },
        value: {
          code: "dates",
        },
      }),
    ).toThrow(
      'Can not update Agreement action target "paymentPreparations" as an object without a key',
    );
  });
});
