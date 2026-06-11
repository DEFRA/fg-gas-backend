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

const generateWmpAnswers = () => {
  return {
    businessDetailsUpToDate: true,
    guidanceRead: true,
    landRegisteredWithRpa: true,
    landManagementControl: false,
    counterSignature: true,
    publicBodyTenant: true,
    tenantObligations: false,
    landHasGrazingRights: true,
    appLandHasExistingWmp: false,
    intendToApplyHigherTier: true,
    includedAllEligibleWoodland: true,
    applicationConfirmation: true,
    hectaresTenOrOverYearsOld: 40.25,
    hectaresUnderTenYearsOld: 15.75,
    woodlandName: "Perf Test Woodland",
    // landParcels[].areaHa must sum to totalHectaresForSelectedParcels (fgSumEquals)
    totalHectaresForSelectedParcels: 79.4865,
    centreGridReference: "SP 1234 5678",
    fcTeamCode: "EAST_AND_EAST_MIDLANDS",
    landParcels: [
      { parcelId: "SD6351-8781", areaHa: 68.0498 },
      { parcelId: "SD6352-8774", areaHa: 11.1006 },
      { parcelId: "SD6252-7537", areaHa: 0.3361 },
    ],
    applicant: {
      business: {
        reference: "1100943757",
        email: { address: "perftest.wmp@example.com" },
        phone: { mobile: "+44 7700 000001", landline: "01234 000001" },
        name: "Perf Test Woodland Ltd",
        address: {
          line1: "1 Test Farm Lane",
          line2: "Test Area",
          line3: null,
          line4: null,
          line5: null,
          street: "Test Farm Lane",
          city: "Testville",
          postalCode: "TE1 1ST",
          uprn: "100000000001",
          buildingName: "Perf Test Farm",
          buildingNumberRange: null,
          county: "North Yorkshire",
          dependentLocality: null,
          doubleDependentLocality: null,
          flatName: null,
          pafOrganisationName: "Perf Test Woodland Ltd",
        },
        vat: "GB000000001",
        type: { code: 101443, type: "Farmer" },
      },
      customer: {
        name: { title: "Mr", first: "Perf", middle: null, last: "Test" },
        email: { address: "perftest.wmp@example.com" },
        phone: { mobile: "+44 7700 000001", landline: "01234 000001" },
        address: {
          line1: "1 Test Cottage",
          line2: "Test Village",
          line3: null,
          line4: null,
          line5: null,
          street: "Test Village",
          city: "Testville",
          postalCode: "TE1 1SU",
          uprn: "100000000002",
          buildingName: "Test Cottage",
          buildingNumberRange: "1",
          county: "North Yorkshire",
          dependentLocality: null,
          doubleDependentLocality: null,
          flatName: null,
          pafOrganisationName: null,
        },
      },
    },
    detailsConfirmedAt: new Date().toISOString(),
    totalAgreementPaymentPence: 154350,
    payments: {
      agreement: [
        {
          code: "PA3",
          description: "Woodland management plan",
          activePaymentTier: 2,
          quantityInActiveTier: 1.45,
          activeTierRatePence: 3000,
          activeTierFlatRatePence: 150000,
          quantity: 51.45,
          agreementTotalPence: 154350,
          unit: "ha",
        },
      ],
    },
  };
};

const createApplications = async (count) => {
  logger.info(`📝 Creating ${count} FRPS test applications...`);

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
        logger.info(`   ✓ Created ${i + 1}/${count} FRPS applications`);
      }
    } catch (error) {
      logger.error(
        `   ✗ Failed to create application ${clientRef}: ${error.message}`,
      );
      throw error;
    }
  }

  logger.info(`   ✓ Created all ${count} FRPS applications`);
  logger.info(
    `   Client refs: perf-test-00000 to perf-test-${String(count - 1).padStart(5, "0")}`,
  );
};

const createWmpApplications = async (count) => {
  logger.info(`📝 Creating ${count} WMP test applications...`);

  const answers = generateWmpAnswers();
  const submittedAt = new Date();

  for (let i = 0; i < count; i++) {
    const clientRef = `wmp-perf-test-${String(i).padStart(5, "0")}`;

    try {
      await submitApplicationUseCase("woodland", {
        metadata: {
          clientRef,
          code: "woodland",
          submittedAt,
          // SBI/CRN pair must match — matches agreements-credentials.csv for OIDC login
          sbi: "106284736",
          frn: "1102838829",
          crn: "1102838829",
        },
        answers,
      });

      if ((i + 1) % 10 === 0) {
        logger.info(`   ✓ Created ${i + 1}/${count} WMP applications`);
      }
    } catch (error) {
      logger.error(
        `   ✗ Failed to create application ${clientRef}: ${error.message}`,
      );
      throw error;
    }
  }

  logger.info(`   ✓ Created all ${count} WMP applications`);
  logger.info(
    `   Client refs: wmp-perf-test-00000 to wmp-perf-test-${String(count - 1).padStart(5, "0")}`,
  );
};

export const seedPerfTestData = async (db) => {
  if (process.env.PERF_TEST_SEED !== "true") {
    return;
  }

  const frpsCount = parseInt(process.env.PERF_TEST_COUNT || "100", 10);
  const wmpCount = parseInt(process.env.PERF_TEST_WMP_COUNT || "100", 10);

  logger.info(`🧹 Starting performance test data seeding...`);
  logger.info(`   Target FRPS application count: ${frpsCount}`);
  logger.info(`   Target WMP application count: ${wmpCount}`);
  logger.info("⚠️  This will CLEAR ALL DATA in test collections");

  await clearCollections(db);
  await createApplications(frpsCount);
  await createWmpApplications(wmpCount);

  logger.info("✅ Performance test data seeding complete!");
  logger.info(
    `   FRPS: ${frpsCount} applications (perf-test-00000 to perf-test-${String(frpsCount - 1).padStart(5, "0")})`,
  );
  logger.info(
    `   WMP:  ${wmpCount} applications (wmp-perf-test-00000 to wmp-perf-test-${String(wmpCount - 1).padStart(5, "0")})`,
  );
};
