import { config } from "../../common/config.js";
import { Outbox } from "../../events/models/outbox.js";
import { insertMany } from "../../events/repositories/outbox.repository.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";

// Claims owns this command because this transition originates there, not in Case Working.
export const enqueueClaimStatusUpdateUseCase = async (
  { clientRef, code, configVersion, newStatus, previousPhase, previousStage },
  session,
) => {
  const statusCommand = new UpdateCaseStatusCommand({
    caseRef: clientRef,
    workflowCode: code,
    configVersion,
    newStatus,
    phase: previousPhase,
    stage: previousStage,
  });

  await insertMany(
    [
      new Outbox({
        event: statusCommand,
        target: config.sns.updateCaseStatusTopicArn,
        segregationRef: Outbox.getSegregationRef(statusCommand),
      }),
    ],
    session,
  );
};
