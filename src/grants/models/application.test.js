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
});
