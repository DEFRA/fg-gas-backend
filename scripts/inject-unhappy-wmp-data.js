import { Decimal128, MongoClient, ObjectId } from "mongodb";
import { config } from "../src/common/config.js";

const client = new MongoClient(config.mongoUri);
const DB_NAME = "farming-grants-agreements-api";

async function injectUnhappyData() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const agreementId = new ObjectId();
    const grantId = new ObjectId();

    // 1. Agreement & Grant
    const agreements = db.collection("agreements");
    const grants = db.collection("grants");
    const versionsCol = db.collection("versions");

    await agreements.insertOne({
      _id: agreementId,
      agreementNumber: "WMP_UNHAPPY",
      clientRef: "wmp-unhappy-ref",
      sbi: "123456789",
      grants: [grantId],
      createdAt: new Date(),
    });

    await grants.insertOne({
      _id: grantId,
      code: "woodland",
      name: "WMP Unhappy Path",
      agreementNumber: "WMP_UNHAPPY",
      clientRef: "wmp-unhappy-ref",
      versions: [], // Will link versions below
    });

    const versions = [
      // Scenario: Missing SBI
      {
        _id: new ObjectId(),
        notificationMessageId: "unhappy-msg-001",
        clientRef: "wmp-missing-sbi",
        code: "woodland",
        status: "accepted",
        grant: grantId,
        identifiers: { sbi: null }, // Trigger MISSING_FIELD
        createdAt: new Date("2026-01-01"),
      },
      // Scenario: Total Mismatch
      {
        _id: new ObjectId(),
        notificationMessageId: "unhappy-msg-002",
        clientRef: "wmp-total-mismatch",
        code: "woodland",
        status: "accepted",
        grant: grantId,
        identifiers: { sbi: "106841262" },
        payment: {
          agreementTotalPence: 200000, // Trigger TOTAL_MISMATCH (we'll ensure calculated is different)
        },
        application: {
          parcel: [
            {
              parcelId: "ST1234-5678",
              actions: [
                {
                  code: "PA3",
                  appliedFor: { quantity: Decimal128.fromString("10") },
                  // In diagnostic, we currently mock calculated total or use 0 if not fully mapped.
                  // I will update diagnostic to be more sensitive to this.
                },
              ],
            },
          ],
        },
        createdAt: new Date("2026-01-02"),
      },
      // Scenario: Version Sequence Invalid
      {
        _id: new ObjectId(),
        notificationMessageId: "unhappy-msg-003",
        clientRef: "wmp-sequence-error",
        code: "woodland",
        status: "accepted",
        grant: grantId,
        identifiers: { sbi: "106841262" },
        createdAt: new Date("2026-01-05"),
      },
      {
        _id: new ObjectId(),
        notificationMessageId: "unhappy-msg-004",
        clientRef: "wmp-sequence-error", // Same clientRef
        code: "woodland",
        status: "accepted",
        grant: grantId,
        identifiers: { sbi: "106841262" },
        createdAt: new Date("2026-01-04"), // EARLIER than previous -> VERSION_SEQUENCE_INVALID
      },
      // Scenario: Parcel ID Unparseable
      {
        _id: new ObjectId(),
        notificationMessageId: "unhappy-msg-005",
        clientRef: "wmp-bad-parcel",
        code: "woodland",
        status: "accepted",
        grant: grantId,
        identifiers: { sbi: "106841262" },
        application: {
          parcel: [
            {
              parcelId: "INVALID_PARCEL_FORMAT", // Trigger PARCEL_ID_UNPARSEABLE
              actions: [{ code: "PA3" }],
            },
          ],
        },
        createdAt: new Date("2026-01-06"),
      },
      // Scenario: PDF Missing (we'll implement this check in diagnostic)
      {
        _id: new ObjectId(),
        notificationMessageId: "unhappy-msg-006",
        clientRef: "wmp-pdf-missing",
        code: "woodland",
        status: "accepted",
        grant: grantId,
        identifiers: { sbi: "106841262" },
        documents: {
          agreement_final: { path: "s3://non-existent/final.pdf" },
        },
        createdAt: new Date("2026-01-07"),
      },
    ];

    await versionsCol.insertMany(versions);
    await grants.updateOne(
      { _id: grantId },
      { $set: { versions: versions.map((v) => v._id) } },
    );

    console.log("Successfully injected unhappy path data.");
  } catch (error) {
    console.error("Injection failed:", error);
  } finally {
    await client.close();
  }
}

injectUnhappyData();
