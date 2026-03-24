/**
 * PERFORMANCE TEST DATA SEEDING
 *
 * This function clears and seeds test data for performance testing.
 * Only runs when PERF_TEST_SEED=true environment variable is set.
 *
 * Creates applications using submitApplicationUseCase to trigger the full
 * message flow to CW backend via SQS.
 *
 * Branch: hotfix/perf-test-seed (DO NOT MERGE TO MAIN)
 */

import { logger } from "../common/logger.js";
import { submitApplicationUseCase } from "./use-cases/submit-application.use-case.js";

const clearCollections = async (db) => {
  logger.info("🗑️  Clearing collections...");

  await db.collection("applications").deleteMany({});
  logger.info("   ✓ Cleared applications");

  await db.collection("application_series").deleteMany({});
  logger.info("   ✓ Cleared application_series");

  await db.collection("outbox").deleteMany({});
  logger.info("   ✓ Cleared outbox");

  await db.collection("inbox").deleteMany({});
  logger.info("   ✓ Cleared inbox");
};

const generateMinimalAnswers = () => {
  return {
    rulesCalculations: {
      id: 1,
      message: "Perf test validation",
      valid: true,
      date: new Date().toISOString(),
    },
    scheme: "frps-private-beta",
    applicant: {
      business: {
        name: "Perf Test Farm Ltd",
        reference: "1100000001",
        email: "perftest@example.com",
        phone: "07123456789",
        address: {
          line1: "123 Test Street",
          line2: "Test Area",
          city: "Testville",
          postalCode: "TE1 1ST",
        },
      },
      customer: {
        name: {
          title: "Mr",
          first: "Test",
          last: "Farmer",
        },
      },
    },
    totalAnnualPaymentPence: 0,
    application: {
      parcel: [],
      agreement: [],
    },
    payments: {
      parcel: [],
      agreement: [],
    },
  };
};

const createApplications = async (count) => {
  logger.info(`📝 Creating ${count} test applications...`);

  const answers = generateMinimalAnswers();
  const submittedAt = new Date();

  for (let i = 0; i < count; i++) {
    const clientRef = `perf-test-${String(i).padStart(5, "0")}`;

    try {
      await submitApplicationUseCase("frps-private-beta", {
        metadata: {
          clientRef,
          sbi: `${107000000 + i}`,
          frn: `${1100000000 + i}`,
          crn: `${1100000000 + i}`,
          submittedAt,
        },
        answers,
      });

      if ((i + 1) % 100 === 0) {
        logger.info(`   ✓ Created ${i + 1}/${count} applications`);
      }
    } catch (error) {
      logger.error(
        `   ✗ Failed to create application ${clientRef}: ${error.message}`,
      );
      throw error;
    }
  }

  logger.info(`   ✓ Created all ${count} applications`);
  logger.info("✅ Performance test data seeding complete!");
  logger.info(`   Total applications: ${count}`);
  logger.info(
    `   Client refs: perf-test-00000 to perf-test-${String(count - 1).padStart(5, "0")}`,
  );
};

const shouldSkipSeeding = (existing, targetCount) => {
  if (existing === targetCount) {
    logger.info(
      `⏭️  Perf test data already seeded with ${targetCount} applications, skipping`,
    );
    return true;
  }
  return false;
};

const logSeedingStart = (existing, targetCount) => {
  const action = existing > 0 ? "re-seed" : "seed";
  logger.info(`🧹 Starting performance test data ${action}...`);
  if (existing > 0) {
    logger.info(`   Found ${existing} applications, target is ${targetCount}`);
  }
  logger.info("⚠️  This will CLEAR ALL DATA in the following collections:");
  logger.info("   - applications");
  logger.info("   - application_series");
  logger.info("   - outbox");
  logger.info("   - inbox");
};

export const seedPerfTestData = async (db) => {
  if (process.env.PERF_TEST_SEED !== "true") {
    return;
  }

  const targetCount = 15000;
  const existing = await db
    .collection("applications")
    .countDocuments({ clientRef: /^perf-test-/ });

  if (shouldSkipSeeding(existing, targetCount)) {
    return;
  }

  logSeedingStart(existing, targetCount);
  await clearCollections(db);
  await createApplications(targetCount);
};
