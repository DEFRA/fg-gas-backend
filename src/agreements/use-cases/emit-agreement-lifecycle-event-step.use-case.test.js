import { describe, expect, it } from "vitest";
import { emitAgreementLifecycleEventStep } from "./emit-agreement-lifecycle-event-step.use-case.js";

describe("emit Agreement lifecycle event step", () => {
  it("records lifecycle publication intent without mutating existing publication intent", () => {
    const publication = {
      paymentClaim: {
        scheme: "SFI",
      },
    };

    expect(
      emitAgreementLifecycleEventStep({
        context: {
          publication,
        },
      }),
    ).toEqual({
      publication: {
        lifecycleEvent: true,
        paymentClaim: {
          scheme: "SFI",
        },
      },
    });
    expect(publication).toEqual({
      paymentClaim: {
        scheme: "SFI",
      },
    });
  });
});
