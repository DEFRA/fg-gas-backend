import { describe, expect, it } from "vitest";
import { config } from "../../common/config.js";
import { AgreementServiceStatus } from "../models/agreement.js";
import { Outbox } from "../models/outbox.js";
import {
  createAgreementCommandPublication,
  updateAgreementStatusCommandPublication,
} from "./agreement-command-publication.js";

describe("Agreement command publication", () => {
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

  it("creates an Agreement status command outbox publication", () => {
    const publication = updateAgreementStatusCommandPublication({
      agreementNumber: "PMF000000001",
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      status: AgreementServiceStatus.Withdrawn,
    });

    expect(publication).toBeInstanceOf(Outbox);
    expect(publication.target).toBe(config.sns.updateAgreementStatusTopicArn);
    expect(publication.segregationRef).toBe("PMF-APP-001-pigs-might-fly");
    expect(publication.event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.status.update",
    );
    expect(publication.event.data).toEqual({
      agreementNumber: "PMF000000001",
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      status: AgreementServiceStatus.Withdrawn,
    });
  });
});
