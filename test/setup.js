import * as path from "node:path";
import { styleText } from "node:util";
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
    .withBuild()
    .withEnvironment({
      GAS_PORT: env.GAS_PORT,
      MONGO_PORT: env.MONGO_PORT,
      LOCALSTACK_PORT: env.LOCALSTACK_PORT,
      OUTBOX_POLL_MS: env.OUTBOX_POLL_MS,
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

  if (env.PRINT_LOGS) {
    const backendContainer = environment.getContainer("gas-1");
    const logStream = await backendContainer.logs();

    logStream.on("data", (line) =>
      process.stdout.write(styleText("gray", line)),
    );
  }
};

export const teardown = async () => {
  await environment?.down();
};
