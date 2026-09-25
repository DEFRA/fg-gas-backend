import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { insertMany } from "../../events/repositories/outbox.repository.js";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { update } from "../repositories/application.repository.js";
import { createStatusTransitionUpdateUseCase } from "./create-status-transition-update.use-case.js";
import { transitionApplicationUseCase } from "./transition-application.use-case.js";

vi.mock("../../events/repositories/outbox.repository.js");
vi.mock("../repositories/application.repository.js");
vi.mock("./create-status-transition-update.use-case.js");

const currentPosition = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};
const targetPosition = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "IN_REVIEW",
};
const phases = [
  {
    code: "PRE_AWARD",
    stages: [
      {
        code: "ASSESSMENT",
        statuses: [
          { code: "APPLICATION_RECEIVED", validFrom: [] },
          {
            code: "IN_REVIEW",
            validFrom: [{ code: "APPLICATION_RECEIVED", processes: [] }],
          },
        ],
      },
    ],
  },
];

const transitionFixture = () => ({
  application: createTestApplication({
    code: "test-grant",
    configVersion: "1.2.3",
    currentPhase: currentPosition.phase,
    currentStage: currentPosition.stage,
    currentStatus: currentPosition.status,
  }),
  grant: createTestGrant({ phases }),
  targetPosition,
  sideEffectContext: {},
});

describe("transitionApplicationUseCase", () => {
  const session = {};
  let publishStatusTransition;

  beforeEach(() => {
    vi.clearAllMocks();
    publishStatusTransition = vi.fn();
    createStatusTransitionUpdateUseCase.mockReturnValue(
      publishStatusTransition,
    );
  });

  it("persists and publishes an application transition", async () => {
    const transition = transitionFixture();

    await transitionApplicationUseCase(transition, session);

    expect(update).toHaveBeenCalledWith(transition.application, session);
    expect(createStatusTransitionUpdateUseCase).toHaveBeenCalledWith({
      clientRef: "application-1",
      code: "test-grant",
      configVersion: "1.2.3",
      originalFullyQualifiedStatus:
        "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      newFullyQualifiedStatus: "PRE_AWARD:ASSESSMENT:IN_REVIEW",
    });
    expect(publishStatusTransition).toHaveBeenCalledWith(session);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it("publishes the Claims-originated Case Working status command", async () => {
    await transitionApplicationUseCase(
      { ...transitionFixture(), publishCaseWorkingStatusUpdate: true },
      session,
    );

    expect(insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          target: config.sns.updateCaseStatusTopicArn,
          event: expect.objectContaining({
            data: expect.objectContaining({
              caseRef: "application-1",
              workflowCode: "test-grant",
              newStatus: "PRE_AWARD:ASSESSMENT:IN_REVIEW",
              supplementaryData: {
                currentConfigVersion: "1.2.3",
                phase: currentPosition.phase,
                stage: currentPosition.stage,
              },
            }),
          }),
        }),
      ],
      session,
    );
  });

  it("keeps a move to the current position as a true no-op", async () => {
    const transition = transitionFixture();

    await transitionApplicationUseCase(
      { ...transition, targetPosition: currentPosition },
      session,
    );

    expect(update).not.toHaveBeenCalled();
    expect(createStatusTransitionUpdateUseCase).not.toHaveBeenCalled();
    expect(insertMany).not.toHaveBeenCalled();
  });
});
