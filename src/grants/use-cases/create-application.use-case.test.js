import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { config } from "../../common/config.js";
import { saveEvents } from "../../events/index.js";
import { Application, ApplicationPhase } from "../models/application.js";
import { save } from "../repositories/application.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";
import { resolveGrantForSubmission } from "./resolve-current-grant.use-case.js";

vi.mock("../../events/index.js");
vi.mock("../repositories/application.repository.js");
vi.mock("./resolve-current-grant.use-case.js");

const session = { transaction: "session" };
const code = "test-grant";
const submission = {
  metadata: {
    clientRef: "test-client-ref",
    sbi: "123456789",
    frn: "987654321",
    crn: "CRN123456",
    defraId: "DEFRA123456",
    submittedAt: "2000-01-01T12:00:00Z",
    configVersion: "1.0.0",
  },
  answers: {
    question1: "answer1",
  },
};

describe("createApplicationUseCase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2000-02-01T13:00:00.000Z"));
    resolveGrantForSubmission.mockResolvedValue({
      grant: createTestGrant(),
      resolvedVersion: "1.0.0",
    });
    save.mockResolvedValue({ insertedId: 1234 });
    saveEvents.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the built Application and returns its inserted id", async () => {
    const result = await createApplicationUseCase(code, submission, session);

    expect(save).toHaveBeenCalledWith(expect.any(Application), session);
    const application = save.mock.calls[0][0];
    expect(application.currentPhase).toBe(ApplicationPhase.PreAward);
    expect(application.clientRef).toBe("test-client-ref");
    expect(result).toBe("1234");
  });

  it("publishes ApplicationCreatedEvent then CreateNewCaseCommand, in order, without an explicit segregationRef", async () => {
    await createApplicationUseCase(code, submission, session);

    expect(saveEvents).toHaveBeenCalledOnce();
    expect(saveEvents).toHaveBeenCalledWith(
      [
        {
          target: config.sns.grantApplicationCreatedTopicArn,
          event: expect.objectContaining({
            data: {
              clientRef: "test-client-ref",
              code: "test-grant",
              originalConfigVersion: "1.0.0",
              status: "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
            },
          }),
        },
        {
          target: config.sns.createNewCaseTopicArn,
          event: expect.objectContaining({
            data: {
              caseRef: "test-client-ref",
              workflowCode: "test-grant",
              previousCaseRef: undefined,
              payload: {
                originalConfigVersion: "1.0.0",
                createdAt: "2000-02-01T13:00:00.000Z",
                submittedAt: "2000-01-01T12:00:00Z",
                identifiers: {
                  sbi: "123456789",
                  frn: "987654321",
                  crn: "CRN123456",
                },
                metadata: { defraId: "DEFRA123456" },
                answers: { question1: "answer1" },
              },
            },
          }),
        },
      ],
      session,
    );
    const publications = saveEvents.mock.calls[0][0];
    expect(publications[0].segregationRef).toBeUndefined();
    expect(publications[1].segregationRef).toBeUndefined();
  });

  it("saves the application before publishing, in the same session", async () => {
    const order = [];
    save.mockImplementation(async () => {
      order.push("save");
      return { insertedId: 1234 };
    });
    saveEvents.mockImplementation(async () => order.push("saveEvents"));

    await createApplicationUseCase(code, submission, session);

    expect(order).toEqual(["save", "saveEvents"]);
    expect(saveEvents.mock.calls[0][1]).toBe(session);
  });

  it("propagates a saveEvents failure without swallowing it", async () => {
    const error = new Error("outbox down");
    saveEvents.mockRejectedValueOnce(error);

    await expect(
      createApplicationUseCase(code, submission, session),
    ).rejects.toBe(error);
  });

  it("does not save or publish when answers fail schema validation", async () => {
    const invalidSubmission = {
      ...submission,
      answers: { question1: 42 },
    };

    await expect(
      createApplicationUseCase(code, invalidSubmission, session),
    ).rejects.toThrow(
      'Application with clientRef "test-client-ref" has invalid answers',
    );
    expect(save).not.toHaveBeenCalled();
    expect(saveEvents).not.toHaveBeenCalled();
  });
});
