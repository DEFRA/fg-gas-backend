import {
  CreateTopicCommand,
  ListTopicsCommand,
  SNSClient,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { execSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { GenericContainer, Wait } from "testcontainers";

export class DevContainers {
  containers = {
    mongodb: null,
    localstack: null,
  };

  async start() {
    try {
      const [mongoResult, localstackResult] = await Promise.all([
        this.#startMongo(),
        this.#startLocalStack(),
      ]);

      this.containers.mongodb = mongoResult.container;
      this.containers.localstack = localstackResult.container;

      return {
        ...mongoResult.env,
        ...localstackResult.env,
      };
    } catch (error) {
      console.error("❌ Failed to start containers:", error.message);
      console.error("\nTry running: npm run dev:clean\n");
      throw error;
    }
  }

  async stop() {
    console.log(
      "\n📦 Containers will remain running for faster subsequent starts",
    );
  }

  async #startMongo() {
    console.log(" ⏳ Starting MongoDB...");

    const container = await new GenericContainer("mongo:6.0.13")
      .withExposedPorts(27017)
      .withCommand(["mongod", "--replSet", "mongoRepl", "--bind_ip", "0.0.0.0"])
      .withReuse()
      .withLabels({ "testcontainers.reuse.id": "defra-shared-mongodb" })
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/i))
      .start();

    const containerName = container.getName();

    try {
      execSync(
        `docker exec ${containerName} mongosh --quiet --eval "rs.status()"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }, // Suppress expected stderr
      );
    } catch (error) {
      try {
        const initResult = execSync(
          `docker exec ${containerName} mongosh --quiet --eval "rs.initiate({ _id: 'mongoRepl', members: [{ _id: 0, host: 'localhost:27017' }] })"`,
          { encoding: "utf-8" },
        );

        if (!initResult.includes("ok")) {
          throw new Error(`Failed to initialize replica set: ${initResult}`);
        }

        let isPrimary = false;
        for (let i = 0; i < 60 && !isPrimary; i++) {
          try {
            const result = execSync(
              `docker exec ${containerName} mongosh --quiet --eval "db.hello().isWritablePrimary"`,
              { encoding: "utf-8" },
            );
            isPrimary = result.trim() === "true";

            if (!isPrimary) {
              if (i % 5 === 0 && i > 0) {
                console.log(`   Still waiting... (${i + 1}/60)`);
              }
              await setTimeout(2000);
            }
          } catch (err) {
            if (i === 30) {
              console.log("   MongoDB taking longer than expected...");
            }
          }
        }

        if (!isPrimary) {
          throw new Error(
            "MongoDB replica set did not elect PRIMARY within timeout",
          );
        }
      } catch (initError) {
        console.error("❌ MongoDB replica set initialization failed");
        console.error(initError.message);
        throw initError;
      }
    }

    const host = container.getHost();
    const port = container.getMappedPort(27017);

    console.log(` ✓  MongoDB ready at ${host}:${port}`);

    return {
      container,
      env: {
        MONGO_URI: `mongodb://${host}:${port}/?replicaSet=mongoRepl&directConnection=true`,
        MONGO_PORT: port.toString(),
      },
    };
  }

  async #startLocalStack() {
    console.log(" ⏳ Starting LocalStack...");

    const container = await new GenericContainer("localstack/localstack:4.3.0")
      .withExposedPorts(4566)
      .withEnvironment({
        SERVICES: "sqs,sns",
        DEBUG: "0",
        LS_LOG: "WARN",
        AWS_REGION: "eu-west-2",
        AWS_ACCESS_KEY_ID: "test",
        AWS_SECRET_ACCESS_KEY: "test",
      })
      .withReuse()
      .withLabels({
        "testcontainers.reuse.id": "defra-shared-localstack", // Shared across all DEFRA apps
      })
      .withWaitStrategy(Wait.forLogMessage(/Ready\./))
      .withStartupTimeout(60000)
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(4566);

    const awsOptions = {
      region: "eu-west-2",
      endpoint: `http://${host}:${port}`,
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    };

    const snsClient = new SNSClient(awsOptions);
    const sqsClient = new SQSClient(awsOptions);

    const resources = await this.#ensureLocalStackResources(
      snsClient,
      sqsClient,
    );

    const updateStatusUrl = resources.queueUrls.gas__sqs__update_status;
    const updateAgreementStatusUrl =
      resources.queueUrls.gas__sqs__update_agreement_status;

    console.log(` ✓  LocalStack ready at ${host}:${port}`);

    return {
      container,
      env: {
        AWS_ENDPOINT_URL: `http://${host}:${port}`,
        LOCALSTACK_PORT: port.toString(),
        GAS__SQS__UPDATE_STATUS_QUEUE_URL: updateStatusUrl.replace(
          "localhost.localstack.cloud",
          "localhost",
        ),
        GAS__SQS__UPDATE_AGREEMENT_STATUS_QUEUE_URL:
          updateAgreementStatusUrl.replace(
            "localhost.localstack.cloud",
            "localhost",
          ),
      },
    };
  }

  async #ensureLocalStackResources(snsClient, sqsClient) {
    // Define resources this app needs (based on compose/start-localstack.sh)
    const topicsAndQueues = [
      {
        topic: "cw__sns__case_status_updated",
        queue: "gas__sqs__update_status",
      },
      {
        topic: "agreement_status_updated",
        queue: "gas__sqs__update_agreement_status",
      },
      {
        topic: "gas__sns__grant_application_created",
        queue: "gas__sqs__grant_application_created",
      },
      {
        topic: "gas__sns__grant_application_status_updated",
        queue: "gas__sqs__grant_application_status_updated",
      },
      {
        topic: "gas__sns__create_new_case",
        queue: "cw__sqs__create_new_case",
      },
      {
        topic: "gas__sns__update_case_status",
        queue: "cw__sqs__update_case_status",
      },
      {
        topic: "gas__sns__create_agreement",
        queue: "create_agreement",
      },
      {
        topic: "cw__sns__case_created",
        queue: "cw__sqs__case_created",
      },
    ];

    const queueUrls = {};

    for (const { topic, queue } of topicsAndQueues) {
      const topicArn = await this.#ensureTopic(snsClient, topic);
      const queueUrl = await this.#ensureQueue(sqsClient, queue);
      const queueArn = await this.#getQueueArn(sqsClient, queueUrl);
      await this.#ensureSubscription(snsClient, topicArn, queueArn);

      queueUrls[queue] = queueUrl;
    }

    return { queueUrls };
  }

  async #ensureTopic(snsClient, topicName) {
    const listResult = await snsClient.send(new ListTopicsCommand({}));
    const existingTopic = listResult.Topics?.find((t) =>
      t.TopicArn.endsWith(`:${topicName}`),
    );

    if (existingTopic) {
      return existingTopic.TopicArn;
    }

    const createResult = await snsClient.send(
      new CreateTopicCommand({ Name: topicName }),
    );
    return createResult.TopicArn;
  }

  async #ensureQueue(sqsClient, queueName) {
    try {
      const getUrlResult = await sqsClient.send(
        new GetQueueUrlCommand({ QueueName: queueName }),
      );
      return getUrlResult.QueueUrl;
    } catch (error) {
      if (error.name !== "QueueDoesNotExist") {
        throw error;
      }
    }

    const dlqName = `${queueName}-dead-letter-queue`;
    let dlqUrl;
    try {
      const getDlqResult = await sqsClient.send(
        new GetQueueUrlCommand({ QueueName: dlqName }),
      );
      dlqUrl = getDlqResult.QueueUrl;
    } catch (error) {
      if (error.name === "QueueDoesNotExist") {
        const createDlqResult = await sqsClient.send(
          new CreateQueueCommand({ QueueName: dlqName }),
        );
        dlqUrl = createDlqResult.QueueUrl;
      } else {
        throw error;
      }
    }

    const dlqArn = await this.#getQueueArn(sqsClient, dlqUrl);

    const createResult = await sqsClient.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlqArn,
            maxReceiveCount: "1",
          }),
        },
      }),
    );
    return createResult.QueueUrl;
  }

  async #getQueueArn(sqsClient, queueUrl) {
    const result = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ["QueueArn"],
      }),
    );
    return result.Attributes.QueueArn;
  }

  async #ensureSubscription(snsClient, topicArn, queueArn) {
    try {
      await snsClient.send(
        new SubscribeCommand({
          TopicArn: topicArn,
          Protocol: "sqs",
          Endpoint: queueArn,
          Attributes: {
            RawMessageDelivery: "true",
          },
        }),
      );
    } catch (error) {
      if (!error.message.includes("already exists")) {
        throw error;
      }
    }
  }
}
