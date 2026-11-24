import { describe, expect, it } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { ApplicationPhase } from "../models/application.js";
import { createApplicationReportingPublications } from "./application-reporting.event.js";

describe("Application receipt reporting", () => {
  it("trims a submitter name supplied as a single string", () => {
    const application = createTestApplication({
      phases: [
        {
          code: ApplicationPhase.PreAward,
          answers: { applicant: { customer: { name: "  Jane Doe  " } } },
        },
      ],
    });

    const [publication] = createApplicationReportingPublications(application);

    expect(publication.event.eventData.applicantName).toBe("Jane Doe");
  });

  it("rejects a receipt without the SBI required by the publisher", () => {
    const application = createTestApplication({
      identifiers: { crn: "9000000001" },
    });

    expect(() => createApplicationReportingPublications(application)).toThrow(
      'Invalid Application reporting event: "eventData.sbi" is required',
    );
  });
});
