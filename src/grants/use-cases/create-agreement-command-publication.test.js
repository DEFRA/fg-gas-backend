import { describe, expect, it } from "vitest";
import { config } from "../../common/config.js";
import { Outbox } from "../models/outbox.js";
import { createAgreementCommandPublication } from "./create-agreement-command-publication.js";

describe("create agreement command publication", () => {
  it("creates the legacy Agreement create command outbox publication", () => {
    const application = {
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      identifiers: { sbi: "123456789" },
      metadata: { defraId: "defra-id-1" },
      getAnswers: () => ({ canPigsFly: true }),
    };

    const publication = createAgreementCommandPublication(application);

    expect(publication).toBeInstanceOf(Outbox);
    expect(publication.target).toBe(config.sns.createAgreementTopicArn);
    expect(publication.segregationRef).toBe("PMF-APP-001-pigs-might-fly");
    expect(publication.event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.create",
    );
    expect(publication.event.data).toEqual({
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      identifiers: { sbi: "123456789" },
      metadata: { defraId: "defra-id-1" },
      answers: { canPigsFly: true },
    });
  });
});
