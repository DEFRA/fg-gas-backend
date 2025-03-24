import { before, after } from "node:test";
import { DockerComposeEnvironment, Wait } from "testcontainers";

let environment;

before(async () => {
  const GAS_PORT = 3001;
  const MONGO_PORT = 27018;

  environment = await new DockerComposeEnvironment(".", "compose.yml")
    .withEnvironment({
      GAS_PORT,
      MONGO_PORT,
    })
    .withWaitStrategy("mongodb", Wait.forListeningPorts())
    .withWaitStrategy("gas", Wait.forHttp("/health"))
    .withNoRecreate()
    .up();

  global.MONGO_URI = `mongodb://localhost:${MONGO_PORT}/fg-gas-backend`;
  global.API_URL = `http://localhost:${GAS_PORT}`;
});

after(async () => {
  await environment?.down();
});
