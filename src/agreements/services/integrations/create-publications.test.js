import { describe, expect, it } from "vitest";
import { config } from "../../../common/config.js";
import { createAgreementPublications } from "./create-publications.js";

describe("createAgreementPublications", () => {
  it("creates a lifecycle publication from the resulting Agreement", () => {
    const agreement = {
      agreementNumber: "PMF123",
      correlationId: "correlation-id",
      clientRef: "client-1",
      code: "pigs-might-fly",
      version: 2,
      state: "accepted",
      identifiers: { sbi: "123456789" },
      updatedAt: "2026-07-17T11:29:00.000Z",
    };

    const publications = createAgreementPublications(["lifecycle"], agreement);

    expect(publications).toEqual([
      {
        target: config.sns.agreementStatusUpdatedTopicArn,
        event: expect.objectContaining({
          data: expect.objectContaining({
            agreementNumber: "PMF123",
            correlationId: "correlation-id",
            clientRef: "client-1",
            code: "pigs-might-fly",
            version: 2,
            status: "accepted",
            date: "2026-07-17T11:29:00.000Z",
            sbi: "123456789",
          }),
        }),
      },
    ]);
  });

  it("keeps Payment Hub identity out of the accepted lifecycle wire", () => {
    const agreement = {
      agreementNumber: "PMF123",
      correlationId: "correlation-id",
      clientRef: "client-1",
      code: "pigs-might-fly",
      version: 2,
      state: "accepted",
      identifiers: { sbi: "123456789" },
      startDate: "2026-08-01",
      endDate: "2027-07-31",
      updatedAt: "2026-07-17T11:29:00.000Z",
    };
    const payment = { paymentHubClaimId: "R00000001" };

    expect(
      createAgreementPublications(["lifecycle"], agreement, payment),
    ).toEqual([
      {
        target: config.sns.agreementStatusUpdatedTopicArn,
        event: expect.objectContaining({
          source: "urn:service:agreement",
          specversion: "1.0",
          type: "io.onsite.agreement.status.updated",
          datacontenttype: "application/json",
          messageGroupId: "client-1-pigs-might-fly",
          data: {
            agreementNumber: "PMF123",
            correlationId: "correlation-id",
            clientRef: "client-1",
            code: "pigs-might-fly",
            version: 2,
            status: "accepted",
            date: "2026-07-17T11:29:00.000Z",
            agreementUrl: "http://localhost:3000/PMF123",
            sbi: "123456789",
            startDate: "2026-08-01",
            endDate: "2027-07-31",
          },
        }),
      },
    ]);
  });

  it("rejects an unsupported publication type with a clear error", () => {
    expect(() => createAgreementPublications(["unknown"], {})).toThrow(
      'Unsupported Agreement publication type: "unknown"',
    );
  });
});
