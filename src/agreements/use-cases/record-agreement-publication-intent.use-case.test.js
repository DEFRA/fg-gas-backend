import { describe, expect, it } from "vitest";
import {
  recordAgreementLifecyclePublicationIntent,
  recordAgreementPaymentClaimPublicationIntent,
} from "./record-agreement-publication-intent.use-case.js";

describe("record Agreement publication intent", () => {
  it("records payment claim publication without mutating existing intent", () => {
    const publication = {
      lifecycleEvent: true,
    };
    const paymentClaim = {
      deliveryBody: "RP00",
      scheme: "SFI",
    };

    expect(
      recordAgreementPaymentClaimPublicationIntent({
        paymentClaim,
        publication,
      }),
    ).toEqual({
      lifecycleEvent: true,
      paymentClaim,
    });
    expect(publication).toEqual({
      lifecycleEvent: true,
    });
  });

  it("records lifecycle event publication without mutating existing intent", () => {
    const publication = {
      paymentClaim: {
        deliveryBody: "RP00",
      },
    };

    expect(
      recordAgreementLifecyclePublicationIntent({
        publication,
      }),
    ).toEqual({
      lifecycleEvent: true,
      paymentClaim: {
        deliveryBody: "RP00",
      },
    });
    expect(publication).toEqual({
      paymentClaim: {
        deliveryBody: "RP00",
      },
    });
  });
});
