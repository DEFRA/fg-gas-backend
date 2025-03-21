import { before, after } from "node:test";
import { DockerComposeEnvironment, Wait } from "testcontainers";
const PORT = 3001;
const MONGO_PORT = 28017;

let environment;

before(async () => {
  environment = await new DockerComposeEnvironment(".", "compose.yml")
    .withEnvironment({ PORT: PORT.toString() })
    .withEnvironment({ MONGO_PORT: MONGO_PORT.toString() })
    .withWaitStrategy("mongodb", Wait.forListeningPorts())
    .withWaitStrategy("gas", Wait.forLogMessage("server started"))
    .up();
  const container = environment.getContainer("mongodb-1");
  global.MONGO_URI = `mongodb://${container.getHost()}:${MONGO_PORT}`;
  global.APP_URL = `http://${container.getHost()}:${PORT}`;
});

after(async () => {
  if (environment) await environment.stop();
});
