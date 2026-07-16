import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wreck } from "../helpers/wreck.js";

const agreementNumber = "PMF823153884";
const code = "pigs-might-fly";
const clientRef = "xnp-rr3-nfb";
const sbi = "300000070";
const agreementId = "invoke-agreement-action-id";
const agreementItemId = "invoke-agreement-action-item-id";

const toItem = (state) => ({
  agreementItemId,
  agreementCode: code,
  clientRef,
  sourceSystem: "GAS",
  configVersion: "0.0.1",
  identifiers: { sbi },
  payload: {},
  createdAt: "2026-07-15T12:00:00.000Z",
  state,
});

const toAgreement = () => ({
  _id: agreementId,
  agreementNumber,
  code,
  identifiers: { sbi },
  items: [toItem("offered")],
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-15T12:00:00.000Z",
});

const toVersion = (state) => ({
  _id: `invoke-agreement-action-version-${state}`,
  agreementId,
  agreementNumber,
  version: 1,
  snapshot: {
    ...toAgreement(),
    items: [toItem(state)],
  },
  createdAt: "2026-07-15T12:01:00.000Z",
});

const requestAction = async (
  actionName,
  answers = {},
  headerOverrides = {},
) => {
  const res = await wreck.request(
    "POST",
    `/agreements/${agreementNumber}/items/${agreementItemId}/actions/${actionName}`,
    {
      headers: {
        "if-match": `"${agreementNumber}:1"`,
        "idempotency-key": "9ea924aa-45e9-43a7-888e-c25054ea658c",
        ...headerOverrides,
      },
      payload: { values: answers },
    },
  );
  const payload = await wreck.read(res, { json: true });

  return { res, payload };
};

const prepareAction = async (actionName) => {
  const res = await wreck.request(
    "GET",
    `/agreements/${agreementNumber}/items/${agreementItemId}/actions/${actionName}`,
  );
  const payload = await wreck.read(res, { json: true });

  return { res, payload };
};

describe("Agreement actions", () => {
  let client;
  let agreements;
  let versions;

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    const database = client.db();
    agreements = database.collection("agreements__agreements");
    versions = database.collection("agreements__versions");
  });

  beforeEach(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      agreements?.deleteMany({ agreementNumber }),
      versions?.deleteMany({ agreementNumber }),
    ]);
    await client?.close();
  });

  const seedAgreement = async (state = "offered") => {
    const agreement = toAgreement();
    const version = toVersion(state);
    await agreements.insertOne(agreement);
    await versions.insertOne(version);

    return { agreement, version };
  };

  const expectPersistenceUnchanged = async ({ agreement, version }) => {
    await expect(agreements.findOne({ agreementNumber })).resolves.toEqual(
      agreement,
    );
    await expect(
      versions.find({ agreementNumber }).sort({ version: 1 }).toArray(),
    ).resolves.toEqual([version]);
  };

  it("prepares the configured form without mutating the Agreement", async () => {
    const persisted = await seedAgreement();

    const { res, payload } = await prepareAction("accept");

    expect(res.statusCode).toBe(200);
    expect(payload).toEqual({
      agreementNumber,
      code,
      clientRef,
      sbi,
      state: "offered",
      version: 1,
      page: {
        name: "accept",
        title: "Accept your agreement offer",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Accept your agreement offer",
        },
        {
          component: "checkboxes",
          name: "confirm",
          items: [
            {
              value: "confirmed",
              text: "I confirm I have read the information in this section and accept this agreement offer.",
            },
          ],
        },
      ],
      actions: [
        {
          name: "accept",
          method: "POST",
          href: `/agreements/${agreementNumber}/items/${agreementItemId}/actions/accept`,
          text: "Accept agreement offer",
        },
      ],
    });
    await expectPersistenceUnchanged(persisted);
  });

  it("accepts the Agreement and redirects to its newly current page", async () => {
    await seedAgreement();

    const { res } = await requestAction("accept", {
      confirm: "confirmed",
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(
      `/agreements/${agreementNumber}?code=${code}&clientRef=${clientRef}&sbi=${sbi}`,
    );

    const storedVersions = await versions
      .find({ agreementNumber })
      .sort({ version: 1 })
      .toArray();
    expect(storedVersions).toHaveLength(2);
    expect(storedVersions[1]).toMatchObject({
      agreementId,
      agreementNumber,
      version: 2,
      actionExecution: {
        name: "accept",
        agreementItemId,
        idempotencyKey: "9ea924aa-45e9-43a7-888e-c25054ea658c",
      },
      snapshot: {
        items: [
          expect.objectContaining({
            state: "accepted",
          }),
        ],
      },
    });
    expect(storedVersions[1].snapshot.items[0]).not.toHaveProperty(
      "supplementaryData.acceptedAt",
    );

    const redirected = await wreck.request("GET", res.headers.location);
    const page = await wreck.read(redirected, { json: true });
    expect(redirected.statusCode).toBe(200);
    expect(page).toMatchObject({
      agreementNumber,
      state: "accepted",
      version: 2,
      page: { name: "accepted" },
    });
  });

  it("changes only the Agreement Item identified by the action URL", async () => {
    await seedAgreement();
    const otherItem = {
      ...toItem("offered"),
      agreementItemId: "another-agreement-item-id",
      clientRef: "another-client-ref",
    };
    await agreements.updateOne(
      { agreementNumber },
      { $push: { items: otherItem } },
    );
    await versions.updateOne(
      { agreementNumber },
      { $push: { "snapshot.items": otherItem } },
    );

    const { res } = await requestAction("accept", { confirm: "confirmed" });

    expect(res.statusCode).toBe(303);
    const currentVersion = await versions.findOne({
      agreementNumber,
      version: 2,
    });
    expect(
      currentVersion.snapshot.items.find(
        (item) => item.agreementItemId === agreementItemId,
      ).state,
    ).toBe("accepted");
    expect(
      currentVersion.snapshot.items.find(
        (item) => item.agreementItemId === otherItem.agreementItemId,
      ).state,
    ).toBe("offered");
  });

  it("returns the original redirect when a successful submission is retried", async () => {
    await seedAgreement();

    const first = await requestAction("accept", { confirm: "confirmed" });
    const retry = await requestAction("accept", { confirm: "confirmed" });

    expect(first.res.statusCode).toBe(303);
    expect(retry.res.statusCode).toBe(303);
    expect(retry.res.headers.location).toBe(first.res.headers.location);
    await expect(versions.countDocuments({ agreementNumber })).resolves.toBe(2);
  });

  it("allows only one concurrent acceptance to commit", async () => {
    await seedAgreement();

    const submissions = await Promise.all([
      requestAction(
        "accept",
        { confirm: "confirmed" },
        { "idempotency-key": "2f7e85ea-7d49-4e1f-a3e4-9e60ddf6220c" },
      ),
      requestAction(
        "accept",
        { confirm: "confirmed" },
        { "idempotency-key": "16ab6e34-bbe7-46b8-804e-94f35f454bd1" },
      ),
    ]);

    expect(submissions.map(({ res }) => res.statusCode).sort()).toEqual([
      303, 412,
    ]);
    await expect(versions.countDocuments({ agreementNumber })).resolves.toBe(2);
  });

  it("returns 412 when an opaque If-Match value is stale", async () => {
    const persisted = await seedAgreement();

    const res = await wreck.request(
      "POST",
      `/agreements/${agreementNumber}/items/${agreementItemId}/actions/accept`,
      {
        headers: {
          "if-match": '"opaque-etag"',
          "idempotency-key": "9ea924aa-45e9-43a7-888e-c25054ea658c",
        },
        payload: { values: { confirm: "confirmed" } },
      },
    );
    const payload = await wreck.read(res, { json: true });

    expect(res.statusCode).toBe(412);
    expect(payload).toMatchObject({
      statusCode: 412,
      error: "Precondition Failed",
    });
    await expectPersistenceUnchanged(persisted);
  });

  it("rejects a stale prepared form and identifies the current Agreement", async () => {
    const persisted = await seedAgreement();

    const { res, payload } = await requestAction(
      "accept",
      { confirm: "confirmed" },
      { "if-match": `"${agreementNumber}:3"` },
    );

    expect(res.statusCode).toBe(412);
    expect(res.headers.location).toBe(
      `/agreements/${agreementNumber}?code=${code}&clientRef=${clientRef}&sbi=${sbi}`,
    );
    expect(payload).toMatchObject({
      statusCode: 412,
      error: "Precondition Failed",
    });
    await expectPersistenceUnchanged(persisted);
  });

  it("requires stale-form and retry protection", async () => {
    const persisted = await seedAgreement();
    const path = `/agreements/${agreementNumber}/items/${agreementItemId}/actions/accept`;
    const payload = { values: { confirm: "confirmed" } };

    const missingIfMatch = await wreck.request("POST", path, {
      headers: {
        "idempotency-key": "9ea924aa-45e9-43a7-888e-c25054ea658c",
      },
      payload,
    });
    const missingIdempotencyKey = await wreck.request("POST", path, {
      headers: { "if-match": `"${agreementNumber}:1"` },
      payload,
    });

    expect(missingIfMatch.statusCode).toBe(400);
    expect(missingIdempotencyKey.statusCode).toBe(400);
    await expectPersistenceUnchanged(persisted);
  });

  it("renders the configured page and error when confirmation is missing", async () => {
    const persisted = await seedAgreement();

    const { res, payload } = await requestAction("accept");

    expect(res.statusCode).toBe(422);
    expect(payload).toEqual({
      agreementNumber,
      code,
      clientRef,
      sbi,
      state: "offered",
      version: 1,
      page: {
        name: "accept",
        title: "Accept your agreement offer",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Accept your agreement offer",
        },
        {
          component: "checkboxes",
          name: "confirm",
          items: [
            {
              value: "confirmed",
              text: "I confirm I have read the information in this section and accept this agreement offer.",
            },
          ],
        },
      ],
      actions: [
        {
          name: "accept",
          method: "POST",
          href: `/agreements/${agreementNumber}/items/${agreementItemId}/actions/accept`,
          text: "Accept agreement offer",
        },
      ],
      values: {},
      errors: [
        {
          name: "confirm",
          href: "#confirm",
          message: "Confirm this agreement offer before accepting it",
        },
      ],
    });
    await expectPersistenceUnchanged(persisted);
  });

  it("rejects an action not configured for the current state", async () => {
    const persisted = await seedAgreement();

    const { res, payload } = await requestAction("decline");

    expect(res.statusCode).toBe(409);
    expect(payload).toMatchObject({
      statusCode: 409,
      error: "Conflict",
      message:
        'Cannot perform action "decline" from agreement state "offered". Available actions: accept.',
    });
    await expectPersistenceUnchanged(persisted);
  });

  it("rejects duplicate accept from the latest accepted snapshot", async () => {
    const persisted = await seedAgreement("accepted");

    const { res } = await requestAction("accept", { confirm: "confirmed" });

    expect(res.statusCode).toBe(409);
    await expectPersistenceUnchanged(persisted);
  });
});
