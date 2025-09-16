import Joi from "joi";
import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { grant1 } from "../fixtures/grants.js";
import { wreck } from "../helpers/wreck.js";

let grants;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
});

afterAll(async () => {
  await client?.close();
});

describe("POST /grants", () => {
  beforeEach(async () => {
    await grants.deleteMany({});
  });

  it("adds a grant", async () => {
    const response = await wreck.post("/grants", {
      payload: grant1,
    });

    expect(response.res.statusCode).toEqual(204);
    expect(response.res.statusMessage).toEqual("No Content");

    const documents = await grants
      .find({}, { projection: { _id: 0 } })
      .toArray();

    expect(documents).toEqual([
      {
        ...grant1,
        metadata: {
          ...grant1.metadata,
          startDate: Joi.date().validate(grant1.metadata.startDate).value,
        },
      },
    ]);
  });

  it("returns 409 when code exists", async () => {
    await wreck.post("/grants", {
      json: true,
      payload: grant1,
    });

    let response;
    try {
      await wreck.post("/grants", {
        json: true,
        payload: grant1,
      });
    } catch (err) {
      response = err.data.payload;
    }

    expect(response).toEqual({
      statusCode: 409,
      error: "Conflict",
      message: `Grant with code "${grant1.code}" already exists`,
    });
  });
});
