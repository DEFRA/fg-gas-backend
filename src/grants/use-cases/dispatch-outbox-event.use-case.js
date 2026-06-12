import { processAgreementCommandUseCase } from "../../agreements/use-cases/process-agreement-command.use-case.js";
import { getMessageGroupId } from "../../common/get-message-group-id.js";
import { publish } from "../../common/sns-client.js";

export const outboxDispatchRoutes = {
  INTERNAL: "internal",
  EXTERNAL: "external",
};

const defaultCommandProcessors = [processAgreementCommandUseCase];

const topicStringToFifo = (topic) => {
  if (topic.search(/_fifo.fifo$/) === -1) {
    return `${topic}_fifo.fifo`;
  }

  return topic;
};

const findCommandProcessor = (command, commandProcessors) =>
  commandProcessors.find((candidate) => candidate.canProcess(command));

const routeCommand = async (command, commandProcessors) => {
  const processor = findCommandProcessor(command, commandProcessors);

  if (!processor) {
    return outboxDispatchRoutes.EXTERNAL;
  }

  return processor.process(command);
};

const publishOutboxEvent = async ({ event, publishEvent }) => {
  const {
    target,
    event: data,
    event: { messageGroupId },
  } = event;

  await publishEvent(
    topicStringToFifo(target),
    data,
    getMessageGroupId(messageGroupId, data),
  );
};

export const createDispatchOutboxEventUseCase =
  ({
    commandProcessors = defaultCommandProcessors,
    publishEvent = publish,
  } = {}) =>
  async (event) => {
    const route = await routeCommand(event.event, commandProcessors);

    if (route === outboxDispatchRoutes.INTERNAL) {
      return;
    }

    await publishOutboxEvent({ event, publishEvent });
  };

export const dispatchOutboxEvent = createDispatchOutboxEventUseCase();
