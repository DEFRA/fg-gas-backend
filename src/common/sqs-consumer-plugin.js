import SqsConsumer from "./sqs-consumer.js";

const sqsConsumerPlugin = {
  name: "sqs-consumer",
  register: async function (server, options) {
    const consumer = new SqsConsumer(server, {
      queueUrl: options.queueUrl,
      handleMessage: options.handleMessage,
    });

    // Register the consumer in server app
    server.app.sqsConsumer = consumer;

    server.events.on("start", async () => {
      await consumer.start();
    });

    server.events.on("stop", async () => {
      await consumer.stop();
    });
  },
};

export default sqsConsumerPlugin;
