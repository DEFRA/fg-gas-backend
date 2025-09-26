import * as path from "node:path";
import { DockerComposeEnvironment, Wait } from "testcontainers";
import { ensureQueues } from "./helpers/sqs.js";

let environment;

export const setup = async ({ globalConfig }) => {
  const { env } = globalConfig;

  const composeFilePath = path.resolve(import.meta.dirname, "..");

  environment = await new DockerComposeEnvironment(
    composeFilePath,
    "compose.yml",
  )
    .withEnvironment({
      GAS_PORT: env.GAS_PORT,
      MONGO_PORT: env.MONGO_PORT,
      LOCALSTACK_PORT: env.LOCALSTACK_PORT,
    })
    .withWaitStrategy("gas", Wait.forHttp("/health"))
    .withNoRecreate()
    .up();

  await ensureQueues([
    env.GAS__SQS__GRANT_APPLICATION_CREATED_QUEUE_URL,
    env.GAS__SQS__GRANT_APPLICATION_STATUS_UPDATED_QUEUE_URL,
    env.CW__SQS__CREATE_NEW_CASE_QUEUE_URL,
    env.GAS__SQS__UPDATE_STATUS_QUEUE_URL,
    env.CREATE_AGREEMENT_QUEUE_URL,
  ]);
};

export const teardown = async () => {
  await environment?.down();
};
