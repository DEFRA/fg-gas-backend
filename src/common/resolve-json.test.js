import { describe, expect, it } from "vitest";
import { resolveJSONPath } from "./resolve-json.js";

describe("resolveJSONPath", () => {
  it("resolves inline JSONPath references inside text", async () => {
    const root = {
      agreement: {
        agreementNumber: "CFG000000001",
      },
    };

    await expect(
      resolveJSONPath({
        root,
        path: "Your agreement number is $.agreement.agreementNumber.",
      }),
    ).resolves.toBe("Your agreement number is CFG000000001.");
  });

  it("omits objects with false display conditions", async () => {
    const root = {
      item: {
        status: "accepted",
      },
    };

    await expect(
      resolveJSONPath({
        root,
        path: [
          {
            component: "notification-banner",
            condition: "jsonata:$.item.status = 'offered'",
            title: "Draft agreement",
          },
          {
            component: "heading",
            condition: "jsonata:$.item.status = 'accepted'",
            level: 1,
            text: "Agreement accepted",
          },
        ],
      }),
    ).resolves.toEqual([
      {
        component: "heading",
        level: 1,
        text: "Agreement accepted",
      },
    ]);
  });

  it("resolves fallback expressions with numbers and strings", async () => {
    const root = {
      answers: {
        presentZero: 0,
        presentText: "hello",
      },
    };

    await expect(
      resolveJSONPath({
        root,
        path: {
          missingNumber: "$.answers.missingNumber ?? 0",
          missingText: "$.answers.missingText ?? ''",
          zeroWithNullish: "$.answers.presentZero ?? 10",
          zeroWithOr: "$.answers.presentZero || 10",
          textWithOr: "$.answers.presentText || 'fallback'",
        },
      }),
    ).resolves.toEqual({
      missingNumber: 0,
      missingText: "",
      zeroWithNullish: 0,
      zeroWithOr: 10,
      textWithOr: "hello",
    });
  });

  it("resolves JSONPath, JSONata, row references and URL templates", async () => {
    const root = {
      agreement: {
        agreementNumber: "CFG000000001",
        sbi: "106284736",
      },
      item: {
        agreementCode: "configurable-grant",
        payload: {
          answers: {
            businessName: "Mason House Farm",
            payment: {
              agreementLevelItems: {
                LARGE: {
                  annualPaymentPence: 125000,
                  code: "LARGE",
                  description: "Large animal",
                },
              },
            },
          },
        },
      },
    };

    await expect(
      resolveJSONPath({
        root,
        path: {
          action: {
            urlTemplate: "/{agreementNumber}/accept",
            params: {
              agreementNumber: "$.agreement.agreementNumber",
            },
          },
          holder: "$.item.payload.answers.businessName\nSBI: $.agreement.sbi",
          table: {
            component: "table",
            rowsRef:
              "jsonata:$each($.item.payload.answers.payment.agreementLevelItems, function($value) { $value })",
            rows: [
              { text: "@.description" },
              { text: "@.code" },
              { text: "@.annualPaymentPence", format: "poundsNoDecimals" },
            ],
          },
        },
      }),
    ).resolves.toEqual({
      action: "/CFG000000001/accept",
      holder: "Mason House Farm\nSBI: 106284736",
      table: {
        component: "table",
        rows: [
          [{ text: "Large animal" }, { text: "LARGE" }, { text: "£1,250" }],
        ],
      },
    });
  });
});
