import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agreement, AgreementStatus } from "./agreement.js";

describe("Agreement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2021, 1, 1, 13));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a new Agreement", () => {
    const agreement = Agreement.new({
      agreementRef: "AG123",
      date: "2024-01-01T00:00:00Z",
    });

    expect(agreement.agreementRef).toBe("AG123");
    expect(agreement.latestStatus).toBe(AgreementStatus.Offered);
    expect(agreement.history).toHaveLength(1);
    expect(agreement.history[0].agreementStatus).toBe(AgreementStatus.Offered);
    expect(agreement.history[0].createdAt).toBe("2024-01-01T00:00:00Z");
    expect(agreement.updatedAt).toEqual("2021-02-01T13:00:00.000Z");
  });

  it("accepts an offered Agreement", () => {
    const agreement = Agreement.new({
      agreementRef: "AG123",
      date: "2024-01-01T00:00:00Z",
    });

    agreement.accept("2024-02-01T00:00:00Z");

    expect(agreement.latestStatus).toBe(AgreementStatus.Accepted);
    expect(agreement.history).toHaveLength(2);
    expect(agreement.history[1].agreementStatus).toBe(AgreementStatus.Accepted);
    expect(agreement.history[1].createdAt).toBe("2024-02-01T00:00:00Z");
    expect(agreement.updatedAt).toEqual("2021-02-01T13:00:00.000Z");
  });

  it("withdraws an offered Agreement", () => {
    const agreement = Agreement.new({
      agreementRef: "AG123",
      date: "2024-01-01T00:00:00Z",
    });

    agreement.withdraw("2024-03-01T00:00:00Z");

    expect(agreement.latestStatus).toBe(AgreementStatus.Withdrawn);
    expect(agreement.history).toHaveLength(2);
    expect(agreement.history[1].agreementStatus).toBe(
      AgreementStatus.Withdrawn,
    );
    expect(agreement.history[1].createdAt).toBe("2024-03-01T00:00:00Z");
    expect(agreement.updatedAt).toEqual("2021-02-01T13:00:00.000Z");
  });
});
