import { DockerComposeEnvironment } from "testcontainers";

let environment;

export const setup = async ({ globalConfig }) => {
  const { env } = globalConfig;

  environment = await new DockerComposeEnvironment(".", "compose.yml")
    .withEnvironment({
      GAS_PORT: env.GAS_PORT,
      MONGO_PORT: env.MONGO_PORT,
      LOCALSTACK_PORT: env.LOCALSTACK_PORT,
    })
    .withNoRecreate()
    .up();
};

export const teardown = async () => {
  await environment?.down();
};
