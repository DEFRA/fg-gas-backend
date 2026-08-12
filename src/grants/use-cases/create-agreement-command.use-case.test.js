import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import {
  clearInternalCommandHandlers,
  internalMessageBusTarget,
  registerInternalCommandHandler,
} from "../../common/internal-command-bus.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import { Application } from "../models/application.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import {
  auditDataBuilder,
  createAgreementCommandUseCase,
} from "./create-agreement-command.use-case.js";

vi.mock("../repositories/outbox.repository.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../../common/write-audit-event.js");

describe("create agreement use case", () => {
  beforeEach(() => {
    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_CREATE,
      vi.fn(),
      {
        canHandle: (command) => command.data.code === "pigs-might-fly",
      },
    );
  });

  afterEach(() => {
    clearInternalCommandHandlers();
  });

  it.each([
    [
      "internal message bus for a configured Agreement definition",
      "pigs-might-fly",
      internalMessageBusTarget,
    ],
    [
      "legacy Agreements topic when no Agreement definition is configured",
      "woodland",
      config.sns.createAgreementTopicArn,
    ],
  ])("targets the %s", async (_description, code, target) => {
    const session = {};
    const application = Application.new({
      currentPhase: "PRE_AWARD",
      currentStage: "AWARD",
      currentStatus: "REVIEW",
      clientRef: "1234",
      code,
      phases: [],
    });
    findByClientRefAndCode.mockResolvedValue(application);

    await createAgreementCommandUseCase(
      { clientRef: "client-ref", code, eventData: {} },
      session,
    );

    expect(insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ target })],
      session,
    );
  });

  it("writes a CREATE_AGREEMENT audit event", async () => {
    const session = {};
    const application = Application.new({
      currentPhase: "PRE_AWARD",
      currentStage: "AWARD",
      currentStatus: "REVIEW",
      clientRef: "1234",
      code: "frps-beta",
      phases: [],
    });
    findByClientRefAndCode.mockResolvedValue(application);

    await createAgreementCommandUseCase(
      { clientRef: "client-ref", code: "code" },
      session,
    );

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          expect.objectContaining({
            entity: auditEntities.APPLICATION,
            action: auditActions.CREATE_AGREEMENT,
            entityid: "client-ref",
          }),
        ],
        details: {
          clientRef: "client-ref",
          code: "code",
        },
        segregationRef: "create-agreement-client-ref",
        status: "SUCCESS",
      }),
      session,
    );
  });
});

describe("auditDataBuilder", () => {
  const args = [{ clientRef: "client-ref", code: "code" }, {}];

  it("emits CREATE_AGREEMENT on the APPLICATION entity with the clientRef as entityid", () => {
    const event = auditDataBuilder(args);

    expect(event.entities[0]).toEqual({
      entity: auditEntities.APPLICATION,
      action: auditActions.CREATE_AGREEMENT,
      entityid: "client-ref",
    });
  });

  it("includes clientRef and code in details", () => {
    const event = auditDataBuilder(args);

    expect(event.details).toEqual({
      clientRef: "client-ref",
      code: "code",
    });
  });

  it("sets segregationRef to create-agreement-{clientRef}", () => {
    const event = auditDataBuilder(args);

    expect(event.segregationRef).toBe("create-agreement-client-ref");
  });
});
