import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wreck } from "../helpers/wreck.js";

const agreementNumber = "PMF823153884";
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
  payload: { whitePigsCount: 5 },
  state: "offered",
  createdAt,
  updatedAt: createdAt,
  supplementaryData: {
    fundingCalculation: {
      items: [{ description: "Large White", total: 32000 }],
    },
  },
});

const paymentEventQuery = {
  "event.data.grants.agreementNumber": agreementNumber,
};

const requestAction = async ({
  values = { confirm: "confirmed" },
  ifMatch = `"${agreementNumber}:1"`,
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
    expect(response.headers.etag).toBe(`"${agreementNumber}:1"`);
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

  it("accepts and atomically records current Agreement, Version and event", async () => {
    const { response } = await requestAction();

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/agreements/current");
    await expect(agreements).toHaveRecord({
      agreementNumber,
      version: 2,
      state: "accepted",
    });
    const accepted = await agreements.findOne({ agreementNumber });
    expect(accepted.acceptedAt).toEqual(expect.any(String));
    await expect(versions).toHaveRecord({
      agreementNumber,
      version: 2,
      "snapshot.state": "accepted",
      "actionExecution.name": "accept",
      "actionExecution.idempotencyKey": idempotencyKey,
    });
  });

  it("commits one Payment with the accepted Version", async () => {
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
      scheme: "SFI",
      sourceSystem: "FPTT",
      deliveryBody: "RP00",
      fesCode: "FALS_FPTT",
      ledger: "AP",
      currency: "GBP",
      paymentRequestNumber: 1,
      originalInvoiceNumber: "",
      totalAmountPence: 32000,
    });
    expect(payment.invoiceNumber).toBe(`${payment.paymentHubClaimId}-V001QX`);
    // GAS claim IDs are seeded above the legacy service's range so the two can
    // issue them concurrently without colliding.
    expect(Number(payment.paymentHubClaimId.slice(1))).toBeGreaterThanOrEqual(
      10000000,
    );
    expect(payment.payments[0]).toMatchObject({
      dueDate: "2026-11-06",
      totalAmountPence: 32000,
      status: "pending",
    });
    expect(payment.payments[0].invoiceLines[0]).toMatchObject({
      schemeCode: "CMOR1",
      description: "Large White Pig",
      amountPence: 32000,
      accountCode: "SOS710",
      fundCode: "DRD10",
      deliveryBody: "RP00",
    });
  });

  it("records the payment event in the outbox with the acceptance", async () => {
    await requestAction();

    await expect(outbox).toHaveRecord(paymentEventQuery);

    const record = await outbox.findOne(paymentEventQuery);
    const payment = await payments.findOne({
      "source.agreementNumber": agreementNumber,
    });

    expect(record.target).toBe(env.GAS__SNS__CREATE_PAYMENT_TOPIC_ARN);
    expect(record.segregationRef).toBe(agreementNumber);
    expect(record.event).toMatchObject({
      type: "io.onsite.agreement.create-payment",
      source: "urn:service:agreement",
      messageGroupId: agreementNumber,
    });
    expect(record.event.data.claimId).toBe(payment.paymentHubClaimId);
  });

  it("publishes the payment event to the Payment Service", async () => {
    await requestAction();

    const payment = await payments.findOne({
      "source.agreementNumber": agreementNumber,
    });

    await expect(env.CREATE_PAYMENT_QUEUE_URL).toHaveReceived({
      id: expect.any(String),
      time: expect.any(String),
      source: "urn:service:agreement",
      specversion: "1.0",
      type: "io.onsite.agreement.create-payment",
      datacontenttype: "application/json",
      messageGroupId: agreementNumber,
      data: {
        sbi: "300000070",
        frn: "1101234567",
        claimId: payment.paymentHubClaimId,
        scheme: "SFI",
        grants: [
          {
            sourceSystem: "FPTT",
            deliveryBody: "RP00",
            fesCode: "FALS_FPTT",
            paymentRequestNumber: 1,
            correlationId: payment.correlationId,
            invoiceNumber: payment.invoiceNumber,
            ledger: "AP",
            originalInvoiceNumber: "",
            agreementNumber,
            totalAmountPence: "32000",
            currency: "GBP",
            marketingYear: payment.marketingYear,
            payments: [
              {
                dueDate: "2026-11-06",
                totalAmountPence: "32000",
                status: "pending",
                correlationId: payment.payments[0].correlationId,
                invoiceLines: [
                  {
                    accountCode: "SOS710",
                    amountPence: "32000",
                    deliveryBody: "RP00",
                    description: "Large White Pig",
                    fundCode: "DRD10",
                    marketingYear:
                      payment.payments[0].invoiceLines[0].marketingYear,
                    schemeCode: "CMOR1",
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });
  it("stores the payment calculation on the Agreement and Version", async () => {
    await requestAction();

    const accepted = await agreements.findOne({ agreementNumber });
    const version = await versions.findOne({ agreementNumber, version: 2 });

    expect(accepted.paymentCalculation.agreementTotalPence).toBe(32000);
    expect(accepted.paymentCalculation.agreementEndDate).toBe("2027-07-31");
    expect(version.snapshot.paymentCalculation.agreementTotalPence).toBe(32000);
  });

  it("returns a render-ready validation page without changing the Agreement", async () => {
    const { response, payload } = await requestAction({ values: {} });

    expect(response.statusCode).toBe(422);
    expect(response.headers.etag).toBe(`"${agreementNumber}:1"`);
    expect(payload).toMatchObject({
      page: { name: "accept", title: "Accept your agreement offer" },
      components: [
        { component: "heading", text: "Accept your agreement offer" },
        {
          component: "checkboxes",
          name: "confirm",
          errorMessage: {
            text: "Confirm this agreement offer before accepting it",
          },
          items: [
            {
              value: "confirmed",
              checked: false,
            },
          ],
        },
      ],
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

  it("rejects a stale expected version", async () => {
    const { response } = await requestAction({ ifMatch: '"PMF823153884:0"' });

    expect(response.statusCode).toBe(412);
    expect(response.headers.etag).toBe(`"${agreementNumber}:1"`);
  });

  it("replays a successful idempotency key without another Version", async () => {
    const first = await requestAction();
    const replay = await requestAction();

    expect(first.response.statusCode).toBe(303);
    expect(replay.response.statusCode).toBe(303);
    expect(await versions.countDocuments({ agreementNumber })).toBe(2);
    expect(
      await payments.countDocuments({
        "source.agreementNumber": agreementNumber,
      }),
    ).toBe(1);
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
    ).toBe(1);
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
      const { response } = await requestAction();

      expect(response.statusCode).toBe(500);
      expect(await agreements.findOne({ agreementNumber })).toMatchObject({
        agreementNumber,
        version: 1,
        state: "offered",
      });
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
