import { agreementCommandDelivery } from "../../agreements/use-cases/deliver-agreement-command.use-case.js";
import { getMessageGroupId } from "../../common/get-message-group-id.js";
import { publish } from "../../common/sns-client.js";

const defaultDeliveryAdapters = [agreementCommandDelivery];

const topicStringToFifo = (topic) => {
  if (topic.endsWith(".fifo")) {
    return topic;
  }

  return `${topic}_fifo.fifo`;
};

const findDeliveryAdapter = (event, deliveryAdapters) =>
  deliveryAdapters.find((candidate) => candidate.canDeliver(event));

const deliverInternally = async (event, deliveryAdapters) => {
  const adapter = findDeliveryAdapter(event, deliveryAdapters);

  if (!adapter) {
    return false;
  }

  return adapter.deliver(event);
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
    deliveryAdapters = defaultDeliveryAdapters,
    publishEvent = publish,
  } = {}) =>
  async (event) => {
    if (await deliverInternally(event, deliveryAdapters)) {
      return;
    }

    await publishOutboxEvent({ event, publishEvent });
  };

export const dispatchOutboxEvent = createDispatchOutboxEventUseCase();
