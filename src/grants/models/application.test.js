import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agreement, AgreementStatus } from "./agreement.js";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "./application.js";

describe("Application", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2021, 1, 1, 13));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("approves application", () => {
    const application = Application.new({
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

    application.approve();

    expect(application.currentStatus).toBe(ApplicationStatus.Approved);
    expect(application.updatedAt).toBe("2021-02-01T13:00:00.000Z");
  });

  it("throws an error when approving an already approved application", () => {
    const application = new Application({
      clientRef: "application-1",
      code: "grant-1",
      currentStatus: ApplicationStatus.Approved,
    });

    expect(() => {
      application.approve();
    }).toThrowError(
      'Application with clientRef "application-1" and code "grant-1" is already approved',
    );
  });

  it("creates a new Application", () => {
    const application = Application.new({
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
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.Received,
      clientRef: "application-1",
      code: "grant-1",
      createdAt: "2021-02-01T13:00:00.000Z",
      submittedAt: "2021-01-01T00:00:00.000Z",
      updatedAt: "2021-02-01T13:00:00.000Z",
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

  it("adds an agreement to an application", () => {
    const application = Application.new({
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

    const agreement = Agreement.new({
      agreementRef: "agreement-1",
      date: "2021-02-01T13:00:00.000Z",
    });

    application.addAgreement(agreement);

    expect(application.currentStatus).toBe(ApplicationStatus.Review);

    expect(application.agreements).toEqual({
      "agreement-1": agreement,
    });
  });

  it("throws an error when adding a duplicate agreement to an application", () => {
    const application = Application.new({
      clientRef: "application-1",
    });

    const agreement = Agreement.new({
      agreementRef: "agreement-1",
      date: "2021-02-01T13:00:00.000Z",
    });

    application.addAgreement(agreement);

    expect(() => {
      application.addAgreement(agreement);
    }).toThrowError(
      'Agreement "agreement-1" already exists on application "application-1"',
    );
  });

  it("accepts an agreement on an application", () => {
    const application = Application.new({
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

    const agreement = Agreement.new({
      agreementRef: "agreement-1",
      date: "2021-02-01T13:00:00.000Z",
    });

    application.addAgreement(agreement);
    application.acceptAgreement("agreement-1", "2021-02-02T14:00:00.000Z");

    expect(application.currentStatus).toBe(ApplicationStatus.Accepted);
    expect(application.getAgreement("agreement-1").latestStatus).toBe(
      AgreementStatus.Accepted,
    );
  });

  it("throws an error when accepting a non-existent agreement", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    expect(() => {
      application.acceptAgreement(
        "non-existent-agreement",
        "2021-02-02T14:00:00.000Z",
      );
    }).toThrowError(
      'Agreement "non-existent-agreement" does not exist on application "application-1"',
    );
  });

  it("withdraws an agreement on an application", () => {
    const application = Application.new({
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

    const agreement = Agreement.new({
      agreementRef: "agreement-1",
      date: "2021-02-01T13:00:00.000Z",
    });

    application.addAgreement(agreement);

    expect(application.currentStatus).toBe(ApplicationStatus.Review);
    expect(application.getAgreement("agreement-1").latestStatus).toBe(
      AgreementStatus.Offered,
    );

    application.withdrawAgreement("agreement-1", "2021-02-03T15:00:00.000Z");

    expect(application.currentStatus).toBe(ApplicationStatus.Withdrawn);
    expect(application.getAgreement("agreement-1").latestStatus).toBe(
      AgreementStatus.Withdrawn,
    );
  });

  it("throws an error when withdrawing a non-existent agreement", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    expect(() => {
      application.withdrawAgreement(
        "non-existent-agreement",
        "2021-02-03T15:00:00.000Z",
      );
    }).toThrowError(
      'Agreement "non-existent-agreement" does not exist on application "application-1"',
    );
  });

  it("gets the fully qualified status", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    expect(application.getFullyQualifiedStatus()).toBe(
      `${ApplicationPhase.PreAward}:${ApplicationStage.Assessment}:${ApplicationStatus.Received}`,
    );
  });

  it("returns null when getting a non-existent agreement", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    expect(application.getAgreement("non-existent-agreement")).toBe(null);
  });

  it("returns empty array when no agreements exist", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    const agreementsData = application.getAgreementsData();

    expect(agreementsData).toEqual([]);
  });

  it("returns array with single agreement data", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    const agreement = Agreement.new({
      agreementRef: "agreement-1",
      date: "2021-02-01T13:00:00.000Z",
    });

    application.addAgreement(agreement);

    const agreementsData = application.getAgreementsData();

    expect(agreementsData).toEqual([
      {
        agreementRef: "agreement-1",
        agreementStatus: AgreementStatus.Offered,
        createdAt: "2021-02-01T13:00:00.000Z",
        updatedAt: "2021-02-01T13:00:00.000Z",
      },
    ]);
  });

  it("returns array with multiple agreements data", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    const agreement1 = Agreement.new({
      agreementRef: "agreement-1",
      date: "2021-02-01T13:00:00.000Z",
    });

    const agreement2 = Agreement.new({
      agreementRef: "agreement-2",
      date: "2021-02-02T14:00:00.000Z",
    });

    application.addAgreement(agreement1);
    application.addAgreement(agreement2);

    const agreementsData = application.getAgreementsData();

    expect(agreementsData).toHaveLength(2);
    expect(agreementsData).toEqual(
      expect.arrayContaining([
        {
          agreementRef: "agreement-1",
          agreementStatus: AgreementStatus.Offered,
          createdAt: "2021-02-01T13:00:00.000Z",
          updatedAt: "2021-02-01T13:00:00.000Z",
        },
        {
          agreementRef: "agreement-2",
          agreementStatus: AgreementStatus.Offered,
          createdAt: "2021-02-02T14:00:00.000Z",
          updatedAt: "2021-02-01T13:00:00.000Z",
        },
      ]),
    );
  });

  it("includes correct createdAt from agreement history", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    const agreement = Agreement.new({
      agreementRef: "agreement-1",
      date: "2021-02-01T13:00:00.000Z",
    });

    application.addAgreement(agreement);

    const agreementsData = application.getAgreementsData();

    expect(agreementsData[0].createdAt).toBe("2021-02-01T13:00:00.000Z");
    expect(agreementsData[0].createdAt).toBe(agreement.history[0].createdAt);
  });

  it("includes updated status after agreement state change", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    const agreement = Agreement.new({
      agreementRef: "agreement-1",
      date: "2021-02-01T13:00:00.000Z",
    });

    application.addAgreement(agreement);
    application.acceptAgreement("agreement-1", "2021-02-02T14:00:00.000Z");

    const agreementsData = application.getAgreementsData();

    expect(agreementsData[0].agreementStatus).toBe(AgreementStatus.Accepted);
    expect(agreementsData[0].createdAt).toBe("2021-02-01T13:00:00.000Z");
    expect(agreementsData[0].updatedAt).toBe("2021-02-01T13:00:00.000Z");
  });

  it("returns correct data for multiple agreements with different statuses", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
    });

    const agreement1 = Agreement.new({
      agreementRef: "agreement-1",
      date: "2021-02-01T13:00:00.000Z",
    });

    const agreement2 = Agreement.new({
      agreementRef: "agreement-2",
      date: "2021-02-02T14:00:00.000Z",
    });

    application.addAgreement(agreement1);
    application.addAgreement(agreement2);

    application.acceptAgreement("agreement-1", "2021-02-03T15:00:00.000Z");

    const agreementsData = application.getAgreementsData();

    expect(agreementsData).toHaveLength(2);

    const agreement1Data = agreementsData.find(
      (a) => a.agreementRef === "agreement-1",
    );
    const agreement2Data = agreementsData.find(
      (a) => a.agreementRef === "agreement-2",
    );

    expect(agreement1Data).toEqual({
      agreementRef: "agreement-1",
      agreementStatus: AgreementStatus.Accepted,
      createdAt: "2021-02-01T13:00:00.000Z",
      updatedAt: "2021-02-01T13:00:00.000Z",
    });

    expect(agreement2Data).toEqual({
      agreementRef: "agreement-2",
      agreementStatus: AgreementStatus.Offered,
      createdAt: "2021-02-02T14:00:00.000Z",
      updatedAt: "2021-02-01T13:00:00.000Z",
    });
  });
});
