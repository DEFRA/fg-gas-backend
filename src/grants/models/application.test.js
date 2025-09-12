import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "./application.js";

describe("Application", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2021, 1, 1, 13));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates an Application model", () => {
    const application = new Application({
      clientRef: "application-1",
      code: "grant-1",
      submittedAt: "2021-01-01T00:00:00.000Z",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        answer1: "test",
      },
    });

    expect(application).toEqual({
      clientRef: "application-1",
      code: "grant-1",
      currentPhase: "PRE_AWARD",
      currentStage: "application",
      status: "PENDING",
      createdAt: "2021-02-01T13:00:00.000Z",
      submittedAt: "2021-01-01T00:00:00.000Z",
      agreements: {},
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        answer1: "test",
      },
    });
  });

  it("updates status", () => {
    const application = new Application({
      clientRef: "application-1",
      code: "grant-1",
      submittedAt: "2021-01-01T00:00:00.000Z",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        answer1: "test",
      },
    });

    application.updateStatus("OFFER_ACCEPTED");
    expect(application.currentPhase).toBe("PRE_AWARD");
    expect(application.currentStage).toBe("AWARD");
    expect(application.status).toBe("PRE_AWARD:AWARD:OFFER_ACCEPTED");
  });

  it("stores existing agreement status", () => {
    const application = new Application({
      clientRef: "application-1",
      code: "grant-1",
      submittedAt: "2021-01-01T00:00:00.000Z",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        answer1: "test",
      },
    });

    application.agreements = {
      "agreement-1": {
        latestStatus: "Foo",
        updatedAt: "2021-01-01T00:00:00.000Z",
        history: [
          {
            createdAt: "2021-01-01T00:00:00.000Z",
            agreementStatus: "accepted",
          },
        ],
      },
    };

    application.storeAgreement({
      agreementRef: "agreement-1",
      agreementStatus: "withdrawn",
      createdAt: "2021-03-01T00:00:00.000Z",
    });

    expect(application.agreements["agreement-1"].history.length).toBe(2);
    expect(application.agreements["agreement-1"].latestStatus).toBe(
      "withdrawn",
    );
    expect(application.agreements["agreement-1"].history[1]).toEqual({
      agreementStatus: "withdrawn",
      createdAt: "2021-03-01T00:00:00.000Z",
    });
  });

  it("creates a new agreement status", () => {
    const application = new Application({
      clientRef: "application-1",
      code: "grant-1",
      submittedAt: "2021-01-01T00:00:00.000Z",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        answer1: "test",
      },
    });

    application.agreements = {
      "agreement-1": {
        latestStatus: "Foo",
        updatedAt: "2021-01-01T00:00:00.000Z",
        history: [
          {
            createdAt: "2021-01-01T00:00:00.000Z",
            agreementStatus: "accepted",
          },
        ],
      },
    };

    application.storeAgreement({
      agreementRef: "agreement-2",
      agreementStatus: "accepted",
      createdAt: "2021-03-01T00:00:00.000Z",
    });

    expect(application.agreements["agreement-2"].history.length).toBe(1);
    expect(application.agreements["agreement-2"].latestStatus).toBe("accepted");
    expect(application.agreements["agreement-2"].history[0]).toEqual({
      agreementStatus: "accepted",
      createdAt: "2021-03-01T00:00:00.000Z",
    });
  });
});
