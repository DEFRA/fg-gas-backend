import { describe, expect, it } from "vitest";
import {
  AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE,
  AgreementPaymentRequestedEvent,
} from "./agreement-payment-requested.event.js";

const agreement = () => ({
  agreementNumber: "PMF823153883",
  version: 2,
  code: "pigs-might-fly",
  configVersion: "1.2.0",
  correlationId: "4f00e743-c3ea-4d76-a064-7bdafd44fc93",
  identifiers: { sbi: "106284736", frn: "1101234567" },
  state: "accepted",
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-06",
        totalAmountPence: 3800,
      },
    ],
  },
});

const executedAt = "2026-08-06T10:15:00.000Z";

describe("AgreementPaymentRequestedEvent", () => {
  it("captures the complete immutable Agreement payment context", () => {
    const sourceAgreement = agreement();
    const event = new AgreementPaymentRequestedEvent({
      agreement: sourceAgreement,
      executedAt,
    });

    expect(event).toMatchObject({
      id: expect.any(String),
      type: AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE,
      specversion: "1.0",
      datacontenttype: "application/json",
      time: expect.any(String),
      messageGroupId: "PMF823153883",
      data: {
        requestId: "agreement:PMF823153883:v2",
        source: {
          agreementNumber: "PMF823153883",
          agreementVersion: 2,
        },
        code: "pigs-might-fly",
        configVersion: "1.2.0",
        executedAt,
        snapshot: sourceAgreement,
      },
    });

    sourceAgreement.paymentSchedule.instalments[0].totalAmountPence = 1;
    expect(
      event.data.snapshot.paymentSchedule.instalments[0].totalAmountPence,
    ).toBe(3800);
    expect(
      Object.isFrozen(event.data.snapshot.paymentSchedule.instalments[0]),
    ).toBe(true);
  });

  it("rejects a request without its pinned version or execution time", () => {
    const sourceAgreement = agreement();
    delete sourceAgreement.configVersion;

    expect(
      () =>
        new AgreementPaymentRequestedEvent({
          agreement: sourceAgreement,
          executedAt: "not-a-time",
        }),
    ).toThrow(/agreement.configVersion.*executedAt/);
  });
});
