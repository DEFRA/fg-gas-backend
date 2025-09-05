import * as path from "node:path";
import { DockerComposeEnvironment, Wait } from "testcontainers";

let environment;

export const setup = async ({ globalConfig }) => {
  const { env } = globalConfig;

  const composeFilePath = path.resolve(import.meta.dirname, "..");

  try {
    environment = await new DockerComposeEnvironment(
      composeFilePath,
      "compose.yml",
    )
      .withEnvironment({
        GAS_PORT: env.GAS_PORT,
        MONGO_PORT: env.MONGO_PORT,
        LOCALSTACK_PORT: env.LOCALSTACK_PORT,
      })
      .withWaitStrategy("gas", Wait.forHttp("/health", { timeout: 60000 }))
      .withWaitStrategy("localstack", Wait.forListeningPorts())
      .withWaitStrategy("mongodb", Wait.forListeningPorts())
      .up();

    console.log("✅ TestContainers setup completed");
  } catch (error) {
    console.error("❌ TestContainers setup failed:", error.message);
    throw error;
  }
};

export const teardown = async () => {
  try {
    await environment?.down();
    console.log("✅ TestContainers teardown completed");
  } catch (error) {
    console.error("⚠️ TestContainers teardown failed:", error.message);
  }
};
