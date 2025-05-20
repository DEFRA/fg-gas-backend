import { logger } from "../common/logger.js";
import { approveApplicationUseCase } from "../use-cases/approve-application-use-case.js";

export const onCaseStageUpdated = async (message) => {
  logger.info(`Processing message: ${message.MessageId}`);

  const { data } = JSON.parse(message.Body);

  if (data.currentStage === "contract") {
    await approveApplicationUseCase(data.clientRef);
    logger.info(`Application ${data.clientRef} has been approved`);
  }
};
