import { describe, expect, it } from "vitest";
import { agreementActionResult } from "./agreement-action-result.js";
import { Agreement } from "./agreement.js";

describe("Agreement action result", () => {
  it("describes the outcome for the resolved Agreement item", () => {
    const agreement = Agreement.fromDocument({
      _id: "agreement-id",
      agreementNumber: "PMF000000001",
      code: "pigs-might-fly",
      items: [
        {
          agreementItemId: "agreement-item-id",
          clientRef: "PMF-APP-001",
        },
      ],
    });
    const item = agreement.items[0];
    const version = {
      id: "version-2",
    };

    expect(
      agreementActionResult({
        agreement,
        item,
        publication: {
          lifecycleEvent: true,
        },
        status: "accepted",
        version,
      }),
    ).toEqual({
      agreement,
      agreementId: "agreement-id",
      agreementItemId: "agreement-item-id",
      agreementNumber: "PMF000000001",
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      item,
      publication: {
        lifecycleEvent: true,
      },
      status: "accepted",
      version,
    });
  });
});
