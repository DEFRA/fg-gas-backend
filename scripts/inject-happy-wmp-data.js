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
    const agreementId = new ObjectId("6a1991f712df5413e7e6f706");
    const grantId = new ObjectId("6a1991f712df5413e7e6f709");

    await agreements.deleteOne({ _id: agreementId });
    await grants.deleteOne({ _id: grantId });
    await versionsCol.deleteMany({ grant: grantId });

    // 1. Inject the Agreement
    await agreements.insertOne({
      _id: agreementId,
      agreementNumber: "WMP511921015",
      clientRef: "wmp-kx2-yjf",
      sbi: "106841262",
      frn: "106841262",
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
      agreementNumber: "WMP511921015",
      clientRef: "wmp-kx2-yjf",
      sbi: "106841262",
      frn: "106841262",
      versions: [
        new ObjectId("6a588c08ca29f920440b672e"),
        new ObjectId("6a58aeb0ca29f920440b6774"),
        new ObjectId("6a5f7d5567f11d6ed48db40e"),
        new ObjectId("6a637952de6d93b63dbefd46"),
        new ObjectId("6a71cbeb700e6d5f9fbad436"),
      ],
      createdAt: new Date("2026-05-29T13:17:43.737Z"),
      updatedAt: new Date("2026-08-04T11:24:27.592Z"),
      __v: 0,
    });

    // 3. Inject the Versions
    await versionsCol.insertMany([
      {
        _id: new ObjectId("6a588c08ca29f920440b672e"),
        notificationMessageId: "7ecc123b-e4a3-4308-b608-b2ebdb042759",
        agreementName: "Bil's woods WMP",
        correlationId: "71cf3bf0-0adf-4e9a-bc3d-84ab3e0e342d",
        clientRef: "wmp-kx2-yjf",
        code: "woodland",
        identifiers: { sbi: "106841262", frn: "106841262", crn: "1101092483" },
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
            name: "MORTIMER AND Co.",
            address: {
              line1: "Top Farm Two",
              city: "Clitheroe",
              postalCode: "BB7 4LQ",
            },
          },
          customer: {
            name: { title: "Mrs", first: "Bernardine", last: "O'toole" },
          },
        },
        application: {
          parcel: [
            {
              parcelId: "ST1437-7349",
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
              parcelId: "ST1335-0972",
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
        _id: new ObjectId("6a58aeb0ca29f920440b6774"),
        notificationMessageId: "unique-msg-id-002",
        agreementName: "Bil's woods WMP",
        correlationId: "71cf3bf0-0adf-4e9a-bc3d-84ab3e0e342d",
        clientRef: "wmp-pun-yp3",
        code: "woodland",
        identifiers: { sbi: "106841262", frn: "106841262", crn: "1101092483" },
        status: "accepted",
        grant: grantId,
        scheme: "WMP",
        payment: {
          agreementTotalPence: 150000,
          annualTotalPence: 150000,
          frequency: "OneOff",
        },
        applicant: {
          business: { name: "MORTIMER AND Co." },
          customer: { name: { first: "Bernardine", last: "O'toole" } },
        },
        application: {
          parcel: [
            {
              parcelId: "ST1437-7349",
              actions: [
                {
                  code: "PA3",
                  appliedFor: { quantity: Decimal128.fromString("17") },
                },
              ],
            },
            {
              parcelId: "ST1335-0972",
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
        _id: new ObjectId("6a5f7d5567f11d6ed48db40e"),
        notificationMessageId: "unique-msg-id-003",
        clientRef: "wmp-fjx-4lf",
        code: "woodland",
        identifiers: { sbi: "106841262", frn: "106841262", crn: "1101092483" },
        status: "offered",
        grant: grantId,
        scheme: "WMP",
        payment: { agreementTotalPence: 150000, frequency: "OneOff" },
        application: {
          parcel: [
            {
              parcelId: "ST1437-7349",
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
        _id: new ObjectId("6a637952de6d93b63dbefd46"),
        notificationMessageId: "unique-msg-id-004",
        clientRef: "wmp-ytl-e5u",
        code: "woodland",
        identifiers: { sbi: "106841262", frn: "106841262", crn: "1101092483" },
        status: "accepted",
        grant: grantId,
        scheme: "WMP",
        payment: { agreementTotalPence: 150000, frequency: "OneOff" },
        application: {
          parcel: [
            {
              parcelId: "ST1437-7349",
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
        _id: new ObjectId("6a71cbeb700e6d5f9fbad436"),
        notificationMessageId: "unique-msg-id-005",
        clientRef: "a4l-vjl-4j8",
        code: "frps-private-beta",
        identifiers: { sbi: "106841262", frn: "106841262", crn: "1101092483" },
        status: "accepted",
        grant: grantId,
        scheme: "SFI",
        payment: { agreementTotalPence: 460725, frequency: "Quarterly" },
        application: {
          parcel: [
            {
              parcelId: "7349",
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
