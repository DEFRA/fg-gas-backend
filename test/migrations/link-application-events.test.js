import { MongoClient, ObjectId } from "mongodb";
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
import { up } from "../../migrations/20261027100000-link-application-events.js";
import { agreementStatusUpdated } from "../../src/agreements/events/agreement-status-updated.event.js";
import { logger } from "../../src/common/logger.js";
import { caseCreate } from "../../src/grants/commands/create-new-case.command.js";
import { caseUpdateStatus } from "../../src/grants/commands/update-case-status.command.js";
import { applicationCreated } from "../../src/grants/events/application-created.event.js";
import { applicationStatusUpdated } from "../../src/grants/events/application-status-updated.event.js";
import { claimPaymentRequested } from "../../src/grants/events/claim-payment-requested.event.js";
import { agreementCreate } from "../../src/grants/events/create-agreement.command.js";
import { caseStatusUpdated } from "../../src/grants/events/inbound-event-types.js";
import { agreementStatusUpdate } from "../../src/grants/events/update-agreement-status.command.js";
import { agreementCreatePayment } from "../../src/payments/events/create-payment.event.js";
import { Payment } from "../../src/payments/models/payment.js";

const REF = "client-wmp-test-0061";
const WOODLAND = `application:woodland:${REF}`;
const FRPS = `application:frps-private-beta:${REF}`;

let client;
let db;
let outbox;
let inbox;
let payments;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db("link-application-events-migration");
  outbox = db.collection("outbox");
  inbox = db.collection("inbox");
  payments = db.collection("payments__payments");
});

afterAll(async () => {
  await db?.dropDatabase();
  await client?.close();
});

beforeEach(async () => {
  await db.dropDatabase();
});

const row = (eventType, data, overrides = {}) => ({
  _id: new ObjectId(),
  status: "COMPLETED",
  segregationRef: `${REF}-woodland`,
  event: { id: new ObjectId().toHexString(), type: eventType.sentAs, data },
  eventType: eventType.name,
  refs: [`ref:${REF}`],
  ...overrides,
});

const paymentProps = {
  sbi: "106284736",
  frn: "1101234567",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  paymentRequestNumber: 1,
  invoiceNumber: "R00000001-V001QX",
  originalInvoiceNumber: "",
  ledger: "AP",
  totalAmountPence: 2000,
  currency: "GBP",
  marketingYear: "2026",
  payments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 2000,
      status: "pending",
      correlationId: "9665924f-41b7-43d2-8f68-a17c88c05e42",
      invoiceLines: [
        {
          schemeCode: "CMOR1",
          description: "Large White Pig",
          amountPence: 2000,
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP00",
          marketingYear: "2026",
        },
      ],
    },
  ],
};

const claimSource = {
  type: "claim",
  code: "woodland",
  clientRef: REF,
  clientClaimRef: "C01",
  entitlementId: "5abb45b1-6679-4a5e-92f5-3d13d7b4b74e",
  agreementNumber: "WMP-1",
  agreementVersion: 1,
};

const storePayment = (paymentHubClaimId, source) => {
  const payment = Payment.create({
    ...paymentProps,
    paymentHubClaimId,
    source,
  });

  return payments.insertOne({ _id: payment.id, ...structuredClone(payment) });
};

const paymentRow = (claimId, segregationRef) =>
  row(
    agreementCreatePayment,
    { claimId, grants: [{ agreementNumber: "WMP-1" }] },
    { segregationRef, refs: segregationRef === REF ? [`ref:${REF}`] : [] },
  );

const refsOf = async (collection, _id) =>
  (await collection.findOne({ _id })).refs;

const logged = (spy) => spy.mock.calls.map(([message]) => message).join("\n");

describe("20261027100000-link-application-events", () => {
  it("links every application event to its application within its grant", async () => {
    const rows = [
      row(applicationCreated, { clientRef: REF, code: "woodland" }),
      row(applicationStatusUpdated, { clientRef: REF, grantCode: "woodland" }),
      row(agreementCreate, { clientRef: REF, code: "woodland" }),
      row(agreementStatusUpdate, { clientRef: REF, code: "woodland" }),
      row(agreementStatusUpdated, { clientRef: REF, code: "woodland" }),
      row(claimPaymentRequested, {
        source: { clientRef: REF, code: "woodland" },
      }),
      row(caseCreate, { caseRef: REF, workflowCode: "woodland" }),
      row(caseUpdateStatus, { caseRef: REF, workflowCode: "woodland" }),
    ];
    const received = [
      row(caseStatusUpdated, { caseRef: REF, workflowCode: "woodland" }),
      row(agreementStatusUpdated, { clientRef: REF, code: "woodland" }),
    ];
    await outbox.insertMany(rows);
    await inbox.insertMany(received);

    await up(db);

    for (const { _id } of rows) {
      expect(await refsOf(outbox, _id)).toEqual([`ref:${REF}`, WOODLAND]);
    }
    for (const { _id } of received) {
      expect(await refsOf(inbox, _id)).toEqual([`ref:${REF}`, WOODLAND]);
    }
  });

  it("keeps the same reference in two grants apart", async () => {
    const woodland = row(applicationCreated, {
      clientRef: REF,
      code: "woodland",
    });
    const frps = row(applicationCreated, {
      clientRef: REF,
      code: "frps-private-beta",
    });
    await outbox.insertMany([woodland, frps]);

    await up(db);

    expect(await refsOf(outbox, woodland._id)).toContain(WOODLAND);
    expect(await refsOf(outbox, frps._id)).toContain(FRPS);
    expect(await refsOf(outbox, frps._id)).not.toContain(WOODLAND);
  });

  it("reads the envelope as its writer wrote it, never as it was edited", async () => {
    const edited = row(
      applicationCreated,
      { clientRef: REF, code: "frps-private-beta" },
      {
        originalPayload: {
          id: "original",
          type: applicationCreated.sentAs,
          data: { clientRef: REF, code: "woodland" },
        },
      },
    );
    await outbox.insertOne(edited);

    await up(db);

    expect(await refsOf(outbox, edited._id)).toEqual([`ref:${REF}`, WOODLAND]);
  });

  it("links a Claim's payment from the Payment, and leaves an Agreement's, counted", async () => {
    await storePayment("R00000001", claimSource);
    await storePayment("R00000002", {
      type: "agreement",
      agreementNumber: "WMP-1",
      version: 1,
    });
    const claim = paymentRow("R00000001", REF);
    const agreement = paymentRow("R00000002", "WMP-1");
    await outbox.insertMany([claim, agreement]);
    const info = vi.spyOn(logger, "info");

    await up(db);

    expect(await refsOf(outbox, claim._id)).toEqual([`ref:${REF}`, WOODLAND]);
    expect(await refsOf(outbox, agreement._id)).toEqual([]);
    expect(logged(info)).toContain(
      "1 outbox rows are Agreement payments, linked to no application",
    );
  });

  it("counts and logs the rows it cannot link, and still completes", async () => {
    const noCode = row(applicationCreated, { clientRef: REF });
    const noPayment = paymentRow("R00000009", REF);
    await payments.insertOne({
      _id: "broken",
      paymentHubClaimId: "R00000008",
      source: claimSource,
    });
    const badPayment = paymentRow("R00000008", REF);
    await outbox.insertMany([noCode, noPayment, badPayment]);
    const warn = vi.spyOn(logger, "warn");

    await expect(up(db)).resolves.toBeUndefined();

    expect(await refsOf(outbox, noCode._id)).toEqual([`ref:${REF}`]);
    expect(await refsOf(outbox, noPayment._id)).toEqual([`ref:${REF}`]);
    expect(await refsOf(outbox, badPayment._id)).toEqual([`ref:${REF}`]);
    const messages = logged(warn);
    expect(messages).toContain(
      `1 outbox rows not linked (no grant code or reference in the envelope): ApplicationCreated 1; first ids ${noCode._id}`,
    );
    expect(messages).toContain(
      `1 outbox rows not linked (payment not found): CreateAgreementPayment 1; first ids ${noPayment._id}`,
    );
    expect(messages).toContain(
      `1 outbox rows not linked (payment not valid): CreateAgreementPayment 1; first ids ${badPayment._id}`,
    );
  });

  it("logs counts and ids, never a reference or a grant code", async () => {
    await outbox.insertMany([
      row(applicationCreated, { clientRef: REF, code: "woodland" }),
      row(applicationCreated, { clientRef: REF }),
    ]);
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");

    await up(db);

    const messages = `${logged(info)}\n${logged(warn)}`;
    expect(messages).toContain("Linked 1 outbox rows and 0 inbox rows");
    expect(messages).not.toContain(REF);
    expect(messages).not.toContain("woodland");
  });

  it("leaves other types and linked rows alone, and counts rows never stamped", async () => {
    const audit = row(
      { name: "Audit", sentAs: "audit" },
      {},
      { refs: ["trace:t-1"] },
    );
    const config = row(
      { name: "ConfigVersionUpdated", sentAs: "config-version.updated" },
      { grantCode: "woodland" },
      { refs: [] },
    );
    const linked = row(
      applicationCreated,
      { clientRef: REF, code: "frps-private-beta" },
      { refs: [`ref:${REF}`, WOODLAND] },
    );
    const unstamped = row(
      applicationCreated,
      { clientRef: REF, code: "woodland" },
      { refs: null },
    );
    await outbox.insertMany([audit, linked, unstamped]);
    await inbox.insertOne(config);
    const warn = vi.spyOn(logger, "warn");

    await expect(up(db)).resolves.toBeUndefined();

    expect(await outbox.findOne({ _id: audit._id })).toEqual(audit);
    expect(await outbox.findOne({ _id: linked._id })).toEqual(linked);
    expect(await outbox.findOne({ _id: unstamped._id })).toEqual(unstamped);
    expect(logged(warn)).toContain(
      `1 outbox rows not linked (refs never stamped); first ids ${unstamped._id}`,
    );
    expect(await inbox.findOne({ _id: config._id })).toEqual(config);
  });

  it("keeps a ref a live writer stamps between its read and its write", async () => {
    const created = row(applicationCreated, {
      clientRef: REF,
      code: "woodland",
    });
    await outbox.insertOne(created);
    const writing = {
      collection: (name) => {
        const collection = db.collection(name);

        return name === "outbox"
          ? new Proxy(collection, {
              get: (target, key) =>
                key === "bulkWrite"
                  ? async (...args) => {
                      await target.updateOne(
                        { _id: created._id },
                        { $addToSet: { refs: "trace:live" } },
                      );

                      return target.bulkWrite(...args);
                    }
                  : Reflect.get(target, key, target),
            })
          : collection;
      },
    };

    await up(writing);

    expect(await refsOf(outbox, created._id)).toEqual([
      `ref:${REF}`,
      "trace:live",
      WOODLAND,
    ]);
  });

  it("changes nothing when run again", async () => {
    await outbox.insertMany([
      row(applicationCreated, { clientRef: REF, code: "woodland" }),
      row(applicationCreated, { clientRef: REF }),
      paymentRow("R00000009", REF),
    ]);

    await up(db);
    const once = await outbox.find().sort({ _id: 1 }).toArray();
    await up(db);

    expect(await outbox.find().sort({ _id: 1 }).toArray()).toEqual(once);
  });

  it("links more rows than one batch holds", async () => {
    await outbox.insertMany(
      Array.from({ length: 2500 }, () =>
        row(applicationCreated, { clientRef: REF, code: "woodland" }),
      ),
    );

    await up(db);

    expect(await outbox.countDocuments({ refs: WOODLAND })).toBe(2500);
  });
});
