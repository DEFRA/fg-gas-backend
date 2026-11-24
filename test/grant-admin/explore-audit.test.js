import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPERATOR = { "x-actor": "Jo Operator", "x-actor-id": OID };
const QUERY =
  "db.applications.find({ clientRef: 'app-none' }, { clientRef: 1 })";

let client;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  outbox = client.db().collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const download = (asked) =>
  wreck.post("/grant-admin/explore/query", {
    payload: { query: QUERY, ...asked },
    headers: OPERATOR,
    json: false,
  });

const exploreAudits = () =>
  outbox.find({ "event.audit.entities.action": "EXPLORE_QUERY" }).toArray();

describe("POST /grant-admin/explore/query, audited", () => {
  it("audits a CSV download and a streamed JSON download as the operator who asked", async () => {
    await download({ csv: true });
    await download({ csv: true, documents: true, stream: true });

    await expect.poll(exploreAudits).toHaveLength(2);

    const audited = (await exploreAudits()).map(({ event }) => ({
      user: event.user,
      download: event.audit.details.download,
    }));

    expect(audited).toEqual(
      expect.arrayContaining([
        { user: `AAD/${OID}`, download: "CSV" },
        { user: `AAD/${OID}`, download: "JSON" },
      ]),
    );
  });
});
