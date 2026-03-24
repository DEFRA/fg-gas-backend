/**
 * PERFORMANCE TEST DATA SEEDING MIGRATION
 *
 * ⚠️ WARNING: This migration is ONLY for performance testing environments
 * It will CLEAR ALL DATA and populate test data
 *
 * Usage:
 *   PERF_TEST_SEED=true npm run migrate:perf-test
 *
 * Safety:
 *   - Requires PERF_TEST_SEED=true environment variable
 *   - Will NOT run in production or normal deployments
 *   - Timestamp 99999999999999 ensures it runs last
 *
 * Branch: hotfix/perf-test-seed (DO NOT MERGE TO MAIN)
 */

export const up = async (db) => {
  // Safety check: Require explicit opt-in
  if (process.env.PERF_TEST_SEED !== "true") {
    console.log("⏭️  Skipping perf test seed (PERF_TEST_SEED not set)");
    return;
  }

  console.log("🧹 Starting performance test data seeding...");
  console.log("⚠️  This will CLEAR ALL DATA in the following collections:");
  console.log("   - applications");
  console.log("   - application_series");
  console.log("   - grants (will re-populate from migrations)");
  console.log("   - outbox");
  console.log("   - inbox");

  // Step 1: Clear existing data
  console.log("\n🗑️  Clearing collections...");

  await db.collection("applications").deleteMany({});
  console.log("   ✓ Cleared applications");

  await db.collection("application_series").deleteMany({});
  console.log("   ✓ Cleared application_series");

  await db.collection("outbox").deleteMany({});
  console.log("   ✓ Cleared outbox");

  await db.collection("inbox").deleteMany({});
  console.log("   ✓ Cleared inbox");

  // Note: grants collection populated by previous migrations

  // Step 2: Seed performance test data
  console.log("\n📝 Seeding test data...");

  // Test applications for performance testing
  const testApplications = [];
  const testSeries = [];

  // Generate 100 test applications for load testing
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
        // Add realistic test answers here
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

  if (testApplications.length > 0) {
    await db.collection("applications").insertMany(testApplications);
    console.log(`   ✓ Inserted ${testApplications.length} test applications`);
  }

  if (testSeries.length > 0) {
    await db.collection("application_series").insertMany(testSeries);
    console.log(`   ✓ Inserted ${testSeries.length} test application series`);
  }

  console.log("\n✅ Performance test data seeding complete!");
  console.log(`   Total applications: ${testApplications.length}`);
  console.log(
    `   Client refs: perf-test-000 to perf-test-${String(testApplications.length - 1).padStart(3, "0")}`,
  );
};

export const down = async (db) => {
  // Rollback: Remove all perf test data
  console.log("🔄 Rolling back performance test data...");

  await db.collection("applications").deleteMany({ clientRef: /^perf-test-/ });
  await db
    .collection("application_series")
    .deleteMany({ clientRefs: /^perf-test-/ });

  console.log("✅ Rollback complete");
};
