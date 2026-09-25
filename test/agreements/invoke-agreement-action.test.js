import { MongoClient } from "mongodb";
import { env } from "node:process";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { receiveMessages } from "../helpers/sqs.js";
import { wreck } from "../helpers/wreck.js";

const agreementNumber = "PMF823153884";
const configVersion = "1.0.1";
const etagFor = (version) => `"${agreementNumber}:${version}:${configVersion}"`;
const idempotencyKey = "9ea924aa-45e9-43a7-888e-c25054ea658c";
const createdAt = "2026-07-15T12:00:00.000Z";
const agreementAccessHeaders = {
  "x-agreement-source": "defra",
  "x-agreement-code": "pigs-might-fly",
  "x-agreement-sbi": "300000070",
};

const agreement = () => ({
  _id: agreementNumber,
  agreementNumber,
  version: 1,
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfb",
  configVersion: "1.0.1",
  correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
  identifiers: { sbi: "300000070", frn: "1101234567" },
  application: {
    whitePigsCount: 5,
    britishLandracePigsCount: 0,
    berkshirePigsCount: 0,
    otherPigsCount: 0,
  },
  actions: [
    {
      id: "action:1",
      code: "largeWhite",
      description: "Large White Pig",
      quantity: 5,
      unit: "head",
      ratePence: 1000,
      totalAmountPence: 5000,
    },
  ],
  items: [],
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  totalAmountPence: 5000,
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-06",
        totalAmountPence: 5000,
        lineItems: [{ actionId: "action:1", amountPence: 5000 }],
      },
    ],
  },
  state: "offered",
  createdAt,
  updatedAt: createdAt,
});

const paymentEventQuery = {
  "event.data.grants.agreementNumber": agreementNumber,
};
const paymentRequestQuery = {
  "event.data.source.agreementNumber": agreementNumber,
};

const toFundedValues = (value) => ({
  application: value.application,
  startDate: value.startDate,
  endDate: value.endDate,
  parcels: value.parcels,
  actions: value.actions,
  items: value.items,
  annualAmountPence: value.annualAmountPence,
  totalAmountPence: value.totalAmountPence,
  paymentSchedule: value.paymentSchedule,
});

const explicitTree = (components) => [
  {
    component: "grid-row",
    components: [{ component: "grid-column", width: "two-thirds", components }],
  },
];

const requestAction = async ({
  values = { confirm: "confirmed" },
  ifMatch = etagFor(1),
  key = idempotencyKey,
} = {}) => {
  const response = await wreck.request(
    "POST",
    `/agreements/${agreementNumber}/actions/accept`,
    {
      headers: {
        ...agreementAccessHeaders,
        "if-match": ifMatch,
        "idempotency-key": key,
      },
      payload: { values },
    },
  );
  const payload = await wreck.read(response, { json: true });
  return { response, payload };
};

describe("single Agreement actions", () => {
  let client;
  let agreements;
  let versions;
  let outbox;
  let payments;
  let paymentDefinitions;
  let configVersions;
  let fifoLocks;

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    const database = client.db();
    agreements = database.collection("agreements__agreements");
    versions = database.collection("agreements__versions");
    outbox = database.collection("outbox");
    payments = database.collection("payments__payments");
    paymentDefinitions = database.collection("payments__definitions");
    configVersions = database.collection("config_versions");
    fifoLocks = database.collection("fifo_locks");
  });

  beforeEach(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
      outbox.deleteMany({ "event.data.agreementNumber": agreementNumber }),
      outbox.deleteMany(paymentEventQuery),
      outbox.deleteMany(paymentRequestQuery),
      payments.deleteMany({ "source.agreementNumber": agreementNumber }),
      fifoLocks.deleteMany({
        segregationRef: agreementNumber,
        actor: "OUTBOX",
      }),
    ]);
    const current = agreement();
    await agreements.insertOne(current);
    await versions.insertOne({
      agreementNumber,
      version: 1,
      snapshot: { ...current, _id: undefined },
      versionedAt: createdAt,
    });
    // Keep the running outbox poller from handling the request before the
    // action's transaction and response can be inspected.
    await fifoLocks.insertOne({
      segregationRef: agreementNumber,
      actor: "OUTBOX",
      locked: true,
      lockedAt: new Date(Date.now() + 60_000),
    });
  });

  afterAll(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
      outbox.deleteMany({ "event.data.agreementNumber": agreementNumber }),
      outbox.deleteMany(paymentEventQuery),
      outbox.deleteMany(paymentRequestQuery),
      payments.deleteMany({ "source.agreementNumber": agreementNumber }),
      fifoLocks.deleteMany({
        segregationRef: agreementNumber,
        actor: "OUTBOX",
      }),
    ]);
    await client.close();
  });

  it("prepares the action without Agreement Item identity", async () => {
    const response = await wreck.request(
      "GET",
      `/agreements/${agreementNumber}/actions/accept`,
      { headers: agreementAccessHeaders },
    );
    const payload = await wreck.read(response, { json: true });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe(etagFor(1));
    expect(payload.agreement.agreementNumber).toBe(agreementNumber);
    expect(JSON.stringify(payload)).not.toContain("agreementItem");
  });

  it("does not prepare an action for another SBI account", async () => {
    const response = await wreck.request(
      "GET",
      `/agreements/${agreementNumber}/actions/accept`,
      {
        headers: {
          ...agreementAccessHeaders,
          "x-agreement-sbi": "999999999",
        },
      },
    );

    expect(response.statusCode).toBe(404);
  });

  it("does not expose actions to Caseworking", async () => {
    const response = await wreck.request(
      "GET",
      `/agreements/${agreementNumber}/actions/accept`,
      {
        headers: {
          "x-agreement-source": "entra",
          "x-agreement-code": "pigs-might-fly",
          "x-agreement-sbi": "300000070",
        },
      },
    );

    expect(response.statusCode).toBe(404);
  });

  it("accepts the exact stored offer and atomically records its Version and event", async () => {
    const offered = await agreements.findOne({ agreementNumber });
    const { response } = await requestAction();

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/agreements/current");
    const accepted = await agreements.findOne({ agreementNumber });
    const version = await versions.findOne({ agreementNumber, version: 2 });

    expect(accepted).toMatchObject({
      agreementNumber,
      version: 2,
      state: "accepted",
      acceptedAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(toFundedValues(accepted)).toEqual(toFundedValues(offered));
    expect(version).toMatchObject({
      agreementNumber,
      version: 2,
      actionExecution: { name: "accept", idempotencyKey },
    });
    const persistedAccepted = structuredClone(accepted);
    delete persistedAccepted._id;
    expect(version.snapshot).toEqual(persistedAccepted);
  });

  it("defers Payment creation until after acceptance without leaking claimId", async () => {
    const offered = await agreements.findOne({ agreementNumber });
    const { response } = await requestAction();

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/agreements/current");
    expect(
      await payments.countDocuments({
        "source.agreementNumber": agreementNumber,
      }),
    ).toBe(0);
    expect(await outbox.findOne(paymentRequestQuery)).toMatchObject({
      target: "internal:message-bus",
      event: {
        data: {
          source: { agreementNumber, agreementVersion: 2 },
          configVersion,
          snapshot: {
            agreementNumber,
            version: 2,
            paymentSchedule: offered.paymentSchedule,
          },
        },
      },
    });
    const lifecycle = await outbox.findOne({
      "event.data.agreementNumber": agreementNumber,
    });
    expect(lifecycle.event.data).not.toHaveProperty("claimId");
  });

  it("accepts an internal status command despite a broken Payment definition", async () => {
    const query = { code: "pigs-might-fly", version: configVersion };
    const previous = await paymentDefinitions.findOne(query);
    const previousConfig = await configVersions.findOne({
      grantCode: query.code,
      version: configVersion,
    });
    expect(previousConfig).toBeTruthy();
    await paymentDefinitions.updateOne(
      query,
      { $set: { definition: { invalid: true } } },
      { upsert: true },
    );
    try {
      vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "http://127.0.0.1:1");
      const { handleUpdateAgreementStatusCommandUseCase } =
        await import("../../src/agreements/use-cases/handle-update-agreement-status-command.use-case.js");
      await handleUpdateAgreementStatusCommandUseCase({
        id: "status-acceptance-1",
        data: { agreementNumber, code: query.code, status: "accepted" },
      });

      expect(await agreements.findOne({ agreementNumber })).toMatchObject({
        state: "accepted",
        version: 2,
      });
      expect(await outbox.findOne(paymentRequestQuery)).toMatchObject({
        target: "internal:message-bus",
      });
      expect(
        await payments.countDocuments({
          "source.agreementNumber": agreementNumber,
        }),
      ).toBe(0);
    } finally {
      if (previous) {
        await paymentDefinitions.replaceOne({ _id: previous._id }, previous);
      } else {
        await paymentDefinitions.deleteOne(query);
      }
      await configVersions.replaceOne(
        { _id: previousConfig._id },
        previousConfig,
      );
      vi.unstubAllEnvs();
    }
  });

  it("creates the immutable Payment after acceptance from the stored offer", async () => {
    const offered = await agreements.findOne({ agreementNumber });
    const { response } = await requestAction();

    expect(response.statusCode).toBe(303);
    expect(
      await payments.countDocuments({
        "source.agreementNumber": agreementNumber,
      }),
    ).toBe(0);
    await fifoLocks.updateOne(
      { segregationRef: agreementNumber, actor: "OUTBOX" },
      { $set: { locked: false, lockedAt: null } },
    );
    let payment;
    await vi.waitFor(
      async () => {
        payment = await payments.findOne({
          "source.agreementNumber": agreementNumber,
        });
        expect(payment).toBeTruthy();
      },
      { timeout: 15000 },
    );
    expect(payment).toMatchObject({
      source: { type: "agreement", agreementNumber, version: 2 },
      sbi: "300000070",
      frn: "1101234567",
      paymentHubClaimId: expect.stringMatching(/^R\d{8}$/),
      correlationId: offered.correlationId,
      scheme: "SFI",
      sourceSystem: "FPTT",
      deliveryBody: "RP00",
      fesCode: "FALS_FPTT",
      ledger: "AP",
      totalAmountPence: 5000,
      currency: "GBP",
      marketingYear: "2026",
      payments: [
        expect.objectContaining({
          dueDate: "2026-11-06",
          totalAmountPence: 5000,
          status: "pending",
          invoiceLines: [
            {
              schemeCode: "CMOR1",
              description: "Large White Pig",
              amountPence: 5000,
              accountCode: "SOS710",
              fundCode: "DRD10",
              deliveryBody: "RP00",
              marketingYear: "2026",
            },
          ],
        }),
      ],
    });
    const externalPublication = await outbox.findOne(paymentEventQuery);
    expect(externalPublication).toMatchObject({
      target: expect.stringContaining("gas__sns__create_payment_fifo.fifo"),
      event: {
        type: "io.onsite.agreement.create-payment",
        data: {
          claimId: payment.paymentHubClaimId,
          grants: [
            {
              paymentRequestNumber: 1,
              agreementNumber,
              payments: expect.any(Array),
            },
          ],
        },
      },
    });
    await vi.waitFor(
      async () => {
        const received = await receiveMessages(env.CREATE_PAYMENT_QUEUE_URL);
        expect(received).toContainEqual(externalPublication.event);
      },
      { timeout: 15000 },
    );
    const lifecyclePublication = await outbox.findOne({
      "event.data.agreementNumber": agreementNumber,
    });
    expect(lifecyclePublication.event).toMatchObject({
      type: "io.onsite.agreement.status.updated",
      data: {
        agreementNumber,
        correlationId: offered.correlationId,
        clientRef: offered.clientRef,
        code: offered.code,
        version: 2,
        status: "accepted",
        date: expect.any(String),
        startDate: offered.startDate,
        endDate: offered.endDate,
        agreementUrl: `http://localhost:3000/${agreementNumber}`,
      },
    });
    expect(lifecyclePublication.event.data).not.toHaveProperty("claimId");
    const accepted = await agreements.findOne({ agreementNumber });
    const version = await versions.findOne({ agreementNumber, version: 2 });
    expect(accepted).not.toHaveProperty("paymentCalculation");
    expect(version.snapshot).not.toHaveProperty("paymentCalculation");
  });

  it("sends both scheduled payments in one Payment Service event", async () => {
    await agreements.updateOne(
      { agreementNumber },
      {
        $set: {
          totalAmountPence: 7000,
          "paymentSchedule.instalments": [
            {
              id: "instalment:1",
              dueDate: "2026-11-06",
              totalAmountPence: 5000,
              lineItems: [{ actionId: "action:1", amountPence: 5000 }],
            },
            {
              id: "instalment:2",
              dueDate: "2027-02-06",
              totalAmountPence: 2000,
              lineItems: [{ actionId: "action:1", amountPence: 2000 }],
            },
          ],
        },
      },
    );
    const { response } = await requestAction();
    expect(response.statusCode).toBe(303);
    expect(
      await payments.countDocuments({
        "source.agreementNumber": agreementNumber,
      }),
    ).toBe(0);

    await fifoLocks.updateOne(
      { segregationRef: agreementNumber, actor: "OUTBOX" },
      { $set: { locked: false, lockedAt: null } },
    );
    let external;
    await vi.waitFor(
      async () => {
        external = await outbox.findOne(paymentEventQuery);
        expect(external).toBeTruthy();
      },
      { timeout: 15000 },
    );
    const grant = external.event.data.grants[0];
    expect(external.event.data.grants).toHaveLength(1);
    expect(grant).toMatchObject({
      agreementNumber,
      paymentRequestNumber: 1,
      invoiceNumber: expect.stringMatching(/^R\d{8}-V001QX$/),
      totalAmountPence: "7000",
      payments: [
        { dueDate: "2026-11-06", totalAmountPence: "5000" },
        { dueDate: "2027-02-06", totalAmountPence: "2000" },
      ],
    });
    expect(await outbox.countDocuments(paymentEventQuery)).toBe(1);
  });

  it("returns a render-ready validation page without changing the Agreement", async () => {
    const { response, payload } = await requestAction({ values: {} });

    expect(response.statusCode).toBe(422);
    expect(response.headers.etag).toBe(etagFor(1));
    expect(payload).toMatchObject({
      page: { name: "accept", title: "Accept your agreement offer" },
      components: explicitTree([
        {
          component: "form",
          method: "POST",
          formAction: `/agreements/${agreementNumber}/actions/accept`,
          hiddenFields: [],
          components: [
            {
              component: "heading",
              level: 1,
              text: "Accept your agreement offer",
            },
            {
              component: "url",
              href: `/agreements/${agreementNumber}/document`,
              text: "View the draft agreement (opens in new tab)",
              target: "_blank",
              classes:
                "govuk-link govuk-!-display-block govuk-!-margin-bottom-4",
            },
            {
              component: "paragraph",
              text: "By accepting this offer, you confirm that:",
            },
            {
              component: "unordered-list",
              items: [
                { text: "the information in the agreement is correct" },
                { text: "you have authority to accept the agreement" },
                { text: "you understand this is a test grant" },
              ],
            },
            {
              component: "checkboxes",
              name: "confirm",
              errorMessage: {
                text: "Confirm this agreement offer before accepting it",
              },
              items: [
                {
                  value: "confirmed",
                  text: "I confirm I have read the information in this section and accept this agreement offer.",
                  checked: false,
                },
              ],
            },
            {
              component: "button",
              text: "Accept agreement offer",
              submit: true,
            },
          ],
        },
      ]),
      errors: [
        {
          href: "#confirm",
          text: "Confirm this agreement offer before accepting it",
        },
      ],
      values: {},
    });
    await expect(agreements).toHaveRecord({ agreementNumber, version: 1 });
    expect(await versions.countDocuments({ agreementNumber })).toBe(1);
    expect(
      await outbox.countDocuments({
        "event.data.agreementNumber": agreementNumber,
      }),
    ).toBe(0);
  });

  it("rejects a stale expected version without changing the offer", async () => {
    const offered = await agreements.findOne({ agreementNumber });
    const { response } = await requestAction({ ifMatch: etagFor(0) });

    expect(response.statusCode).toBe(412);
    expect(response.headers.etag).toBe(etagFor(1));
    expect(await agreements.findOne({ agreementNumber })).toEqual(offered);
    expect(await versions.countDocuments({ agreementNumber })).toBe(1);
  });

  it("replays a successful idempotency key without duplicating acceptance", async () => {
    const first = await requestAction();
    const accepted = await agreements.findOne({ agreementNumber });
    const request = await outbox.findOne(paymentRequestQuery);
    const replay = await requestAction();

    expect(first.response.statusCode).toBe(303);
    expect(replay.response.statusCode).toBe(303);
    expect(await versions.countDocuments({ agreementNumber })).toBe(2);
    expect((await agreements.findOne({ agreementNumber })).acceptedAt).toBe(
      accepted.acceptedAt,
    );
    expect(await outbox.countDocuments(paymentRequestQuery)).toBe(1);
    expect(await outbox.findOne(paymentRequestQuery)).toEqual(request);
    expect(
      await payments.countDocuments({
        "source.agreementNumber": agreementNumber,
      }),
    ).toBe(0);
  });

  it("allows only one concurrent acceptance to commit", async () => {
    const submissions = await Promise.all([
      requestAction({
        key: "2f7e85ea-7d49-4e1f-a3e4-9e60ddf6220c",
      }),
      requestAction({
        key: "16ab6e34-bbe7-46b8-804e-94f35f454bd1",
      }),
    ]);

    expect(
      submissions.map(({ response }) => response.statusCode).sort(),
    ).toEqual([303, 412]);
    expect(await versions.countDocuments({ agreementNumber })).toBe(2);
    expect(
      await payments.countDocuments({
        "source.agreementNumber": agreementNumber,
      }),
    ).toBe(0);
    expect(
      await outbox.countDocuments({
        "event.data.agreementNumber": agreementNumber,
      }),
    ).toBe(1);
    expect(await outbox.countDocuments(paymentRequestQuery)).toBe(1);
  });

  it("rolls back acceptance when its durable Payment request cannot be recorded", async () => {
    const indexName = "reject-duplicate-agreement-payment-request";
    const requestId = `agreement:${agreementNumber}:v2`;
    await outbox.createIndex(
      { "event.data.requestId": 1 },
      {
        name: indexName,
        unique: true,
        partialFilterExpression: { "event.data.requestId": requestId },
      },
    );
    await outbox.insertOne({
      _id: "blocking-payment-request",
      event: { data: { requestId } },
      status: "DEAD_LETTER",
    });

    try {
      const offered = await agreements.findOne({ agreementNumber });
      const { response } = await requestAction();

      expect(response.statusCode).toBe(500);
      expect(await agreements.findOne({ agreementNumber })).toEqual(offered);
      expect(await versions.countDocuments({ agreementNumber })).toBe(1);
      expect(await outbox.countDocuments(paymentRequestQuery)).toBe(0);
      expect(
        await outbox.countDocuments({
          "event.data.agreementNumber": agreementNumber,
        }),
      ).toBe(0);
      expect(
        await payments.countDocuments({
          "source.agreementNumber": agreementNumber,
        }),
      ).toBe(0);
    } finally {
      await outbox.dropIndex(indexName);
      await outbox.deleteOne({ _id: "blocking-payment-request" });
    }
  });

  it("rolls back acceptance when its publication cannot be recorded", async () => {
    const indexName = "reject-duplicate-agreement-publication";
    const blockingEventId = "blocking-outbound-event";
    await outbox.createIndex(
      { "event.data.agreementNumber": 1 },
      {
        name: indexName,
        unique: true,
        partialFilterExpression: {
          "event.data.agreementNumber": agreementNumber,
        },
      },
    );
    await outbox.insertOne({
      _id: blockingEventId,
      event: { data: { agreementNumber } },
      status: "DEAD_LETTER",
    });

    try {
      const offered = await agreements.findOne({ agreementNumber });
      const { response } = await requestAction();

      expect(response.statusCode).toBe(500);
      expect(await agreements.findOne({ agreementNumber })).toEqual(offered);
      expect(await versions.countDocuments({ agreementNumber })).toBe(1);
      await expect(versions).toHaveRecord({
        agreementNumber,
        version: 1,
        "snapshot.state": "offered",
      });
      expect(
        await outbox.countDocuments({
          "event.data.agreementNumber": agreementNumber,
        }),
      ).toBe(1);
      expect(
        await payments.countDocuments({
          "source.agreementNumber": agreementNumber,
        }),
      ).toBe(0);
      expect(await outbox.countDocuments(paymentEventQuery)).toBe(0);
    } finally {
      await outbox.deleteOne({ _id: blockingEventId });
      await outbox.dropIndex(indexName);
    }
  });
});
