/**
 * CLEANUP MIGRATION FOR PERF TEST SEED
 *
 * This migration runs immediately before the perf test seed migration and
 * deletes its changelog entry, making it re-runnable on every deployment.
 *
 * This migration also deletes its own changelog entry at the end, so it
 * will run on every deployment as well.
 *
 * Branch: hotfix/perf-test-seed (DO NOT MERGE TO MAIN)
 */

export const up = async (db) => {
  // Safety check: Require explicit opt-in
  if (process.env.PERF_TEST_SEED !== "true") {
    return;
  }

  // Delete the seed migration's changelog entry so it can run again
  await db
    .collection("changelog")
    .deleteOne({ fileName: "99999999999999-perf-test-seed.js" });

  // Delete own changelog entry so this cleanup runs on every deployment
  await db
    .collection("changelog")
    .deleteOne({ fileName: "99999999999998-cleanup-perf-seed-changelog.js" });
};

export const down = async (db) => {
  // No rollback needed
};
