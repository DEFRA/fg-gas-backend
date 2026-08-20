import { Decimal128, MongoClient, ObjectId } from "mongodb";
import { config } from "../src/common/config.js";

const client = new MongoClient(config.mongoUri);
const DB_NAME = "farming-grants-agreements-api";

async function injectHappyData() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const agreements = db.collection("agreements");
    const grants = db.collection("grants");
    const versionsCol = db.collection("versions");

    // Clean up existing data for this specific happy path record to allow re-runs
    const agreementId = new ObjectId("f000000000000000000003e9");
    const grantId = new ObjectId("f000000000000000000003ea");

    await agreements.deleteOne({ _id: agreementId });
    await grants.deleteOne({ _id: grantId });
    await versionsCol.deleteMany({ grant: grantId });

    // 1. Inject the Agreement
    await agreements.insertOne({
      _id: agreementId,
      agreementNumber: "WMP900000301",
      clientRef: "wmp-example-301",
      sbi: "900000301",
      frn: "900000301",
      grants: [grantId],
      createdAt: new Date("2026-05-29T13:17:43.726Z"),
      updatedAt: new Date("2026-05-29T13:17:43.742Z"),
      __v: 0,
    });

    // 2. Inject the Grant
    await grants.insertOne({
      _id: grantId,
      code: "woodland",
      name: "WMP",
      agreementNumber: "WMP900000301",
      clientRef: "wmp-example-301",
      sbi: "900000301",
      frn: "900000301",
      versions: [
        new ObjectId("f000000000000000000003eb"),
        new ObjectId("f000000000000000000003ec"),
        new ObjectId("f000000000000000000003ed"),
        new ObjectId("f000000000000000000003ee"),
        new ObjectId("f000000000000000000003ef"),
      ],
      createdAt: new Date("2026-05-29T13:17:43.737Z"),
      updatedAt: new Date("2026-08-04T11:24:27.592Z"),
      __v: 0,
    });

    // 3. Inject the Versions
    await versionsCol.insertMany([
      {
        _id: new ObjectId("f000000000000000000003eb"),
        notificationMessageId: "00000000-0000-4000-8000-000000001001",
        agreementName: "Bil's woods WMP",
        correlationId: "00000000-0000-4000-8000-000000001000",
        clientRef: "wmp-example-301",
        code: "woodland",
        identifiers: { sbi: "900000301", frn: "900000301", crn: "9100000301" },
        status: "accepted",
        grant: grantId,
        scheme: "WMP",
        payment: {
          agreementStartDate: "2026-08-01",
          agreementEndDate: "2029-07-31",
          frequency: "OneOff",
          agreementTotalPence: 150000,
          annualTotalPence: 150000,
          agreementLevelItems: {
            1: {
              code: "PA3",
              description: "Woodland management plan",
              version: "1",
              annualPaymentPence: 150000,
            },
          },
        },
        applicant: {
          business: {
            name: "Example Woodland Business Ltd",
            address: {
              line1: "6 Example Lane",
              city: "Exampleton",
              postalCode: "ZZ99 1ZZ",
            },
          },
          customer: {
            name: { title: "Mrs", first: "Robin", last: "Example" },
          },
        },
        application: {
          parcel: [
            {
              parcelId: "AA0301-0301",
              area: { unit: "ha", quantity: Decimal128.fromString("35.6517") },
              actions: [
                {
                  code: "PA3",
                  version: "1",
                  appliedFor: {
                    unit: "ha",
                    quantity: Decimal128.fromString("25"),
                  },
                },
              ],
            },
            {
              parcelId: "AA0302-0302",
              area: { unit: "ha", quantity: Decimal128.fromString("0.0827") },
              actions: [
                {
                  code: "PA3",
                  version: "1",
                  appliedFor: {
                    unit: "ha",
                    quantity: Decimal128.fromString("25"),
                  },
                },
              ],
            },
          ],
        },
        createdAt: new Date("2026-07-16T07:45:12.618Z"),
        updatedAt: new Date("2026-07-16T07:45:45.964Z"),
      },
      {
        _id: new ObjectId("f000000000000000000003ec"),
        notificationMessageId: "unique-msg-id-002",
        agreementName: "Bil's woods WMP",
        correlationId: "00000000-0000-4000-8000-000000001000",
        clientRef: "wmp-example-304",
        code: "woodland",
        identifiers: { sbi: "900000301", frn: "900000301", crn: "9100000301" },
        status: "accepted",
        grant: grantId,
        scheme: "WMP",
        payment: {
          agreementTotalPence: 150000,
          annualTotalPence: 150000,
          frequency: "OneOff",
        },
        applicant: {
          business: { name: "Example Woodland Business Ltd" },
          customer: { name: { first: "Robin", last: "Example" } },
        },
        application: {
          parcel: [
            {
              parcelId: "AA0301-0301",
              actions: [
                {
                  code: "PA3",
                  appliedFor: { quantity: Decimal128.fromString("17") },
                },
              ],
            },
            {
              parcelId: "AA0302-0302",
              actions: [
                {
                  code: "PA3",
                  appliedFor: { quantity: Decimal128.fromString("17") },
                },
              ],
            },
          ],
        },
        createdAt: new Date("2026-07-16T10:13:04.337Z"),
        updatedAt: new Date("2026-07-16T10:14:03.005Z"),
      },
      {
        _id: new ObjectId("f000000000000000000003ed"),
        notificationMessageId: "unique-msg-id-003",
        clientRef: "wmp-example-303",
        code: "woodland",
        identifiers: { sbi: "900000301", frn: "900000301", crn: "9100000301" },
        status: "offered",
        grant: grantId,
        scheme: "WMP",
        payment: { agreementTotalPence: 150000, frequency: "OneOff" },
        application: {
          parcel: [
            {
              parcelId: "AA0301-0301",
              actions: [
                {
                  code: "PA3",
                  appliedFor: { quantity: Decimal128.fromString("11") },
                },
              ],
            },
          ],
        },
        createdAt: new Date("2026-07-21T14:08:21.747Z"),
        updatedAt: new Date("2026-07-21T14:08:21.747Z"),
      },
      {
        _id: new ObjectId("f000000000000000000003ee"),
        notificationMessageId: "unique-msg-id-004",
        clientRef: "wmp-example-305",
        code: "woodland",
        identifiers: { sbi: "900000301", frn: "900000301", crn: "9100000301" },
        status: "accepted",
        grant: grantId,
        scheme: "WMP",
        payment: { agreementTotalPence: 150000, frequency: "OneOff" },
        application: {
          parcel: [
            {
              parcelId: "AA0301-0301",
              actions: [
                {
                  code: "PA3",
                  appliedFor: { quantity: Decimal128.fromString("19") },
                },
              ],
            },
          ],
        },
        createdAt: new Date("2026-07-24T14:40:18.802Z"),
        updatedAt: new Date("2026-07-24T14:41:30.153Z"),
      },
      {
        _id: new ObjectId("f000000000000000000003ef"),
        notificationMessageId: "unique-msg-id-005",
        clientRef: "example-app-304",
        code: "frps-private-beta",
        identifiers: { sbi: "900000301", frn: "900000301", crn: "9100000301" },
        status: "accepted",
        grant: grantId,
        scheme: "SFI",
        payment: { agreementTotalPence: 460725, frequency: "Quarterly" },
        application: {
          parcel: [
            {
              parcelId: "0301",
              actions: [
                {
                  code: "CMOR1",
                  appliedFor: { quantity: Decimal128.fromString("35.6517") },
                },
              ],
            },
          ],
        },
        createdAt: new Date("2026-08-04T11:24:27.582Z"),
        updatedAt: new Date("2026-08-04T11:25:43.942Z"),
      },
    ]);

    console.log("Successfully injected happy path Woodland data.");
  } catch (error) {
    console.error("Injection failed:", error);
  } finally {
    await client.close();
  }
}

injectHappyData();
