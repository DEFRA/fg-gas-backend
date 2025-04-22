import { DockerComposeEnvironment, Wait } from "testcontainers";

let environment;

export const setup = async ({ globalConfig }) => {
  const { env } = globalConfig;

  environment = await new DockerComposeEnvironment(".", "compose.yml")
    .withEnvironment({
      GAS_PORT: env.GAS_PORT,
      MONGO_PORT: env.MONGO_PORT,
      LOCALSTACK_PORT: env.LOCALSTACK_PORT,
    })
    .withWaitStrategy("localstack", Wait.forHealthCheck())
    .withWaitStrategy("mongodb", Wait.forListeningPorts())
    .withWaitStrategy("gas", Wait.forHttp("/health"))
    .withNoRecreate()
    .up();
};

export const teardown = async () => {
  await environment?.down();
};
