import Joi from "joi";
import { up } from "migrate-mongo";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mongoClient } from "./common/mongo-client.js";
import { createServer } from "./server.js";

vi.mock("./common/mongo-client.js");
vi.mock("migrate-mongo");

describe("server", () => {
  beforeEach(() => {
    up.mockResolvedValue(["001-initial-migration.js", "002-add-some-data.js"]);
  });
  it("strips trailing slashes", async () => {
    const server = await createServer();
    server.route({
      method: "GET",
      path: "/path",
      handler: () => "Hello, World!",
    });

    await server.initialize();

    const response = await server.inject({
      method: "GET",
      url: "/path/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.request.url.pathname).toBe("/path");
  });

  it("calls MongoClient on start and stop", async () => {
    vi.spyOn(mongoClient, "connect");
    const server = await createServer();
    await server.start();
    expect(mongoClient.connect).toHaveBeenCalled();
    await server.stop();
    expect(mongoClient.close).toHaveBeenCalled();
  });

  it("validates routes", async () => {
    const server = await createServer();
    const expectedErrorMessage = '"Payload" must be of type object';

    server.route({
      method: "POST",
      path: "/broken",
      options: {
        validate: {
          payload: Joi.object({ username: Joi.string().required() }).label(
            "Payload",
          ),
        },
      },
      async handler() {
        /* should not get here */
      },
    });

    await server.initialize();

    const { result, statusCode } = await server.inject({
      method: "POST",
      url: "/broken",
    });

    expect(statusCode).toBe(400);
    expect(result.message).toBe(expectedErrorMessage);
  });
});
