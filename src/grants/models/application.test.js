import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("creates a new Application", () => {
    const application = Application.new({
      clientRef: "application-1",
      code: "grant-1",
      submittedAt: "20201-01-01T00:00:00.000Z",
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
      phase: ApplicationPhase.PreAward,
      stage: ApplicationStage.Assessment,
      status: ApplicationStatus.Received,
      clientRef: "application-1",
      code: "grant-1",
      createdAt: "2021-02-01T13:00:00.000Z",
      updatedAt: "2021-02-01T13:00:00.000Z",
      submittedAt: "20201-01-01T00:00:00.000Z",
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
