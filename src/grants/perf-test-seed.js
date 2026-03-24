/**
 * PERFORMANCE TEST DATA SEEDING
 *
 * This function clears and seeds test data for performance testing.
 * Only runs when PERF_TEST_SEED=true environment variable is set.
 *
 * Branch: hotfix/perf-test-seed (DO NOT MERGE TO MAIN)
 */

import { logger } from "../common/logger.js";

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

const generateTestData = () => {
  const testApplications = [];
  const testSeries = [];

  for (let i = 0; i < 100; i++) {
    const clientRef = `perf-test-${String(i).padStart(3, "0")}`;
    const applicationId = `app-id-${clientRef}`;

    testApplications.push({
      _id: applicationId,
      code: "frps-private-beta",
      clientRef,
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_APPLICATION",
      currentStatus: "APPLICATION_RECEIVED",
      identifiers: {
        sbi: `${107000000 + i}`,
        frn: `${1100000000 + i}`,
        crn: `${1100000000 + i}`,
      },
      metadata: {
        clientRef,
        sbi: `${107000000 + i}`,
        frn: `${1100000000 + i}`,
        crn: `${1100000000 + i}`,
        submittedAt: new Date().toISOString(),
      },
      answers: {
        eligibility: "yes",
        landArea: 100 + i,
      },
      agreements: {},
      phases: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    testSeries.push({
      _id: `series-${clientRef}`,
      code: "frps-private-beta",
      clientRefs: [clientRef],
      latestClientId: applicationId,
      latestClientRef: clientRef,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return { testApplications, testSeries };
};

const insertTestData = async (db, testApplications, testSeries) => {
  logger.info("📝 Seeding test data...");

  await db.collection("applications").insertMany(testApplications);
  logger.info(`   ✓ Inserted ${testApplications.length} test applications`);

  await db.collection("application_series").insertMany(testSeries);
  logger.info(`   ✓ Inserted ${testSeries.length} test application series`);

  logger.info("✅ Performance test data seeding complete!");
  logger.info(`   Total applications: ${testApplications.length}`);
  logger.info(
    `   Client refs: perf-test-000 to perf-test-${String(testApplications.length - 1).padStart(3, "0")}`,
  );
};

export const seedPerfTestData = async (db) => {
  if (process.env.PERF_TEST_SEED !== "true") {
    return;
  }

  logger.info("🧹 Starting performance test data seeding...");
  logger.info("⚠️  This will CLEAR ALL DATA in the following collections:");
  logger.info("   - applications");
  logger.info("   - application_series");
  logger.info("   - outbox");
  logger.info("   - inbox");

  await clearCollections(db);
  const { testApplications, testSeries } = generateTestData();
  await insertTestData(db, testApplications, testSeries);
};
