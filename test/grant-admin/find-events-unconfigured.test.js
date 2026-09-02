import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findEventsResponseSchema } from "../../src/grant-admin/schemas/find-events-response.schema.js";
import { findEventsUseCase } from "../../src/grant-admin/use-cases/find-events.use-case.js";
import { cwStubRequests, resetCwStub } from "../helpers/cw-stub.js";

// The containerised GAS is started with CW_BACKEND_URL/CW_BACKEND_TOKEN set
// (test/setup.js points it at the actuator stub), so the unconfigured case
// cannot be produced over HTTP - the values are baked in at boot. This process,
// however, has neither variable set (test/vitest.config.js does not define
// them), so running the real use case here against the real containerised Mongo
// exercises exactly the "CW_BACKEND_* unset" path with nothing mocked.

let client;
let inbox;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  inbox = client.db().collection("inbox");
  outbox = client.db().collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const at = (minute) =>
  new Date(Date.UTC(2026, 5, 16, 10, minute)).toISOString();

const inboxDoc = (n) => ({
  messageId: `msg-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "COMPLETED",
  completionAttempts: 1,
  eventTime: at(n),
  lastResubmissionDate: null,
  completionDate: at(n),
  segregationRef: `GLD-9B2-BWS-${n}`,
  event: { id: `evt-${n}`, data: { clientRef: "SECRET-REF" } },
  claimedBy: null,
});

const outboxDoc = (n) => ({
  target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case",
  status: "COMPLETED",
  completionAttempts: 1,
  publicationDate: new Date(Date.UTC(2026, 5, 16, 10, n)),
  lastResubmissionDate: null,
  completionDate: at(n),
  segregationRef: `GLD-9B2-BWS-${n}`,
  event: {
    id: `evt-${n}`,
    type: "cloud.defra.local.fg-gas-backend.case.create",
    data: { clientRef: "SECRET-REF" },
  },
  claimedBy: null,
});

describe("findEventsUseCase with CW_BACKEND_* unset", () => {
  it("returns GAS rows with two not configured sourceErrors and makes no HTTP call", async () => {
    await inbox.insertOne(inboxDoc(1));
    await outbox.insertOne(outboxDoc(2));

    const page = await findEventsUseCase({ direction: "forward" });

    expect(page.events.map((event) => `${event.service}/${event.box}`)).toEqual(
      ["gas/outbox", "gas/inbox"],
    );
    expect(page.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "not configured" },
      { service: "caseworking", box: "outbox", message: "not configured" },
    ]);
    expect(await cwStubRequests()).toEqual([]);
    expect(findEventsResponseSchema.validate(page).error).toBeUndefined();
  });

  it("reports no Caseworking sourceError when service=gas", async () => {
    await inbox.insertOne(inboxDoc(1));

    const page = await findEventsUseCase({
      direction: "forward",
      service: "gas",
    });

    expect(page.sourceErrors).toEqual([]);
    expect(page.events).toHaveLength(1);
  });

  it("still pages GAS rows while Caseworking is unconfigured", async () => {
    await inbox.insertMany(
      Array.from({ length: 25 }, (_, n) => inboxDoc(n + 1)),
    );

    const first = await findEventsUseCase({ direction: "forward" });

    expect(first.events).toHaveLength(20);
    expect(first.pagination.hasNextPage).toBe(true);

    const second = await findEventsUseCase({
      cursor: first.pagination.endCursor,
      direction: "forward",
    });

    expect(second.events).toHaveLength(5);
    expect(second.pagination.hasPreviousPage).toBe(true);
  });
});
