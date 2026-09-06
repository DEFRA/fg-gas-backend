import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    const database = client.db();
    agreements = database.collection("agreements__agreements");
    versions = database.collection("agreements__versions");
    outbox = database.collection("outbox");
    payments = database.collection("payments__payments");
  });

  beforeEach(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
      outbox.deleteMany({ "event.data.agreementNumber": agreementNumber }),
      outbox.deleteMany(paymentEventQuery),
      payments.deleteMany({ "source.agreementNumber": agreementNumber }),
    ]);
    const current = agreement();
    await agreements.insertOne(current);
    await versions.insertOne({
      agreementNumber,
      version: 1,
      snapshot: { ...current, _id: undefined },
      versionedAt: createdAt,
    });
  });

  afterAll(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
      outbox.deleteMany({ "event.data.agreementNumber": agreementNumber }),
      outbox.deleteMany(paymentEventQuery),
      payments.deleteMany({ "source.agreementNumber": agreementNumber }),
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

  it("creates the immutable Payment and both publications from the stored offer", async () => {
    const offered = await agreements.findOne({ agreementNumber });
    const { response } = await requestAction();

    expect(response.statusCode).toBe(303);
    const payment = await payments.findOne({
      "source.agreementNumber": agreementNumber,
    });
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
    expect(await outbox.countDocuments(paymentEventQuery)).toBe(1);
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
        claimId: payment.paymentHubClaimId,
        startDate: offered.startDate,
        endDate: offered.endDate,
        agreementUrl: `http://localhost:3000/${agreementNumber}`,
      },
    });
    const accepted = await agreements.findOne({ agreementNumber });
    const version = await versions.findOne({ agreementNumber, version: 2 });
    expect(accepted).not.toHaveProperty("paymentCalculation");
    expect(version.snapshot).not.toHaveProperty("paymentCalculation");
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
    const payment = await payments.findOne({
      "source.agreementNumber": agreementNumber,
    });
    const replay = await requestAction();

    expect(first.response.statusCode).toBe(303);
    expect(replay.response.statusCode).toBe(303);
    expect(await versions.countDocuments({ agreementNumber })).toBe(2);
    expect((await agreements.findOne({ agreementNumber })).acceptedAt).toBe(
      accepted.acceptedAt,
    );
    expect(
      await payments.countDocuments({
        "source.agreementNumber": agreementNumber,
      }),
    ).toBe(1);
    expect(
      await payments.findOne({ "source.agreementNumber": agreementNumber }),
    ).toEqual(payment);
    expect(await outbox.countDocuments(paymentEventQuery)).toBe(1);
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
    ).toBe(1);
    expect(
      await outbox.countDocuments({
        "event.data.agreementNumber": agreementNumber,
      }),
    ).toBe(2);
    expect(await outbox.countDocuments(paymentEventQuery)).toBe(1);
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
