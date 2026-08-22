import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateDefinitionLocation } from "../../../src/common/config-broker/config-catalog.repository.js";
import { config } from "../../../src/common/config.js";
import { FetchStatus } from "../../../src/common/fetch-status.js";
import { ConfigVersion } from "../../../src/grants/models/config-version.js";
import { upsert } from "../../../src/grants/repositories/config-version.repository.js";
import { resolvePaymentDefinition } from "../../../src/payments/use-cases/resolve-payment-definition.js";

const bucket = "config-broker-local";
const grantCode = "pigs-might-fly";
const versions = ["9.9.1", "9.9.2"];
const s3Keys = Object.fromEntries(
  versions.map((version) => [
    version,
    `${grantCode}/payment-real-s3/${version}/gas/payment.json`,
  ]),
);
const paymentDefinitionJson = readFileSync(
  new URL(
    "../../../compose/seed/pigs-might-fly/1.0.0/gas/payment.json",
    import.meta.url,
  ),
  "utf8",
);
const paymentDefinition = JSON.parse(paymentDefinitionJson);

const context = {
  agreement: {
    identifiers: { sbi: "106284736", frn: "1101234567" },
    agreementNumber: "PMF123456789",
    state: "accepted",
    startDate: "2026-08-01",
    endDate: "2027-07-31",
    actions: [
      {
        id: "action:1",
        code: "largeWhite",
        description: "Large White Pig",
        totalAmountPence: 2000,
      },
      {
        id: "action:2",
        code: "berkshire",
        description: "Berkshire",
        totalAmountPence: 1800,
      },
    ],
    items: [{ id: "item:1", code: "pigArk", description: "Pig ark" }],
    totalAmountPence: 3800,
    paymentSchedule: {
      instalments: [
        {
          id: "instalment:1",
          dueDate: "2026-11-06",
          totalAmountPence: 3800,
          lineItems: [
            { actionId: "action:1", amountPence: 2000 },
            {
              itemId: "item:1",
              description: "Seasonal pig ark payment",
              amountPence: 1800,
            },
          ],
        },
      ],
    },
  },
  execution: { executedAt: "2026-08-06T10:15:00.000Z" },
};

const expectedPayment = {
  sbi: "106284736",
  frn: "1101234567",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  totalAmountPence: 3800,
  currency: "GBP",
  marketingYear: "2026",
  duePayments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
      invoiceLines: [
        {
          schemeCode: "CMOR1",
          description: "Large White Pig",
          amountPence: 2000,
          accountCode: "SOS710",
          fundCode: "DRD10",
        },
        {
          schemeCode: "CMOR1",
          description: "Seasonal pig ark payment",
          amountPence: 1800,
          accountCode: "SOS710",
          fundCode: "DRD10",
        },
      ],
    },
  ],
};

const s3Client = new S3Client({
  region: config.region,
  endpoint: config.awsEndpointUrl,
  forcePathStyle: true,
});

let client;
let configVersions;
let paymentDefinitions;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db(env.MONGO_DATABASE);
  configVersions = db.collection("config_versions");
  paymentDefinitions = db.collection("payments__definitions");
});

afterAll(async () => {
  await Promise.all([
    configVersions.deleteMany({ grantCode, version: { $in: versions } }),
    paymentDefinitions.deleteMany({
      code: grantCode,
      version: { $in: versions },
    }),
    ...Object.values(s3Keys).map((Key) =>
      s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key })),
    ),
  ]);
  await client?.close();
});

const upload = (Key, Body) =>
  s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key,
      Body,
      ContentType: "application/json",
    }),
  );

const seedConfigVersion = async (version) => {
  await upsert(
    ConfigVersion.new({
      grantCode,
      version,
      status: "active",
      s3Key: `${grantCode}/payment-real-s3/${version}/gas/gas.json`,
      s3Bucket: bucket,
    }),
  );
  await updateDefinitionLocation({
    grantCode,
    version,
    definitionType: "payment",
    s3Key: s3Keys[version],
  });
};

describe("Payment definition ingestion (real S3)", () => {
  it("loads and resolves the real PMF payment.json from S3", async () => {
    const version = "9.9.1";
    await upload(s3Keys[version], paymentDefinitionJson);
    await seedConfigVersion(version);

    await expect(
      resolvePaymentDefinition({
        code: grantCode,
        configVersion: version,
        context,
      }),
    ).resolves.toEqual(expectedPayment);

    const stored = await paymentDefinitions.findOne({
      code: grantCode,
      version,
    });
    expect(stored).not.toBeNull();
    expect(stored.definition).toEqual(paymentDefinition);

    const configVersion = await configVersions.findOne({ grantCode, version });
    expect(configVersion.definitions.payment.fetchStatus).toBe(
      FetchStatus.Fetched,
    );
  });

  it("records a permanent error when the resolved totals are unbalanced", async () => {
    const version = "9.9.2";
    await upload(
      s3Keys[version],
      JSON.stringify({ ...paymentDefinition, totalAmountPence: 3799 }),
    );
    await seedConfigVersion(version);

    await expect(
      resolvePaymentDefinition({
        code: grantCode,
        configVersion: version,
        context,
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 500 },
      message: expect.stringContaining(
        "totalAmountPence does not balance with duePayments",
      ),
    });

    const configVersion = await configVersions.findOne({ grantCode, version });
    expect(configVersion.definitions.payment.fetchStatus).toBe(
      FetchStatus.PermanentError,
    );
  });
});
