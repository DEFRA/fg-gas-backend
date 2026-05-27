// test/contract/consumer.grants-ui.test.js
// Consumer test: grants-ui consumes HTTP endpoints FROM fg-gas-backend
//
// Interactions covered:
//   GET  /grants/:code/applications/:clientRef/status  → 200 (found) / 404 (not found)
//   POST /grants/frps-private-beta/applications        → 204 (new application, amendment, minimal)
//   POST /grants/woodland/applications                 → 204 (valid) / 400 (invalid hectares)
//
// message: flexible (like) — grants-ui only needs to know the request succeeded/failed,
// not the exact error wording
//
// Authorization header: exact token sent in executeTest; regex matching is provider-side only
//
// IMPORTANT:
// This file mirrors the grants-ui consumer Pact tests.
// The grants-ui repository remains the source of truth.
// Keep interactions in sync to avoid local/broker drift.

import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import path from "path";
import { describe, it } from "vitest";

const { like } = MatchersV3;

const BEARER_TOKEN = "00000000-0000-0000-0000-000000000000";

const pact = new PactV3({
  consumer: "grants-ui",
  provider: "fg-gas-backend",
  dir: path.resolve(process.cwd(), "tmp/pacts"),
  logLevel: "info",
});

const requestHeaders = {
  Authorization: `Bearer ${BEARER_TOKEN}`,
  "Content-Type": "application/json",
};

const frpsApplicationBody = {
  answers: {
    applicant: {
      business: {
        address: {
          city: "Clitheroe",
          line1: "Catlow Road",
          line2: "Groovy Park",
          line3: null,
          line4: null,
          postalCode: "BB7 4LQ",
        },
        email: "cliffspencetasabbeyfarmf@mrafyebbasatecnepsffilcm.com.test",
        landlinePhoneNumber: "01697 751072",
        mobilePhoneNumber: "+44 7900 123456",
        name: "John Woodcock",
        reference: "2396577132",
      },
      customer: {
        name: {
          first: "Antony",
          last: "Williams",
          middle: null,
          title: "Mr.",
        },
      },
    },
    application: {
      agreement: [],
      parcel: [
        {
          actions: [
            {
              appliedFor: { quantity: 681.6133, unit: "ha" },
              code: "CMOR1",
              durationYears: 1,
              version: "1.0.0",
            },
          ],
          area: { quantity: 681.6199, unit: "ha" },
          parcelId: "6060",
          sheetId: "SD5949",
        },
        {
          actions: [
            {
              appliedFor: { quantity: 13.7223, unit: "ha" },
              code: "UPL2",
              durationYears: 1,
              version: "2.0.0",
            },
          ],
          area: { quantity: 13.7223, unit: "ha" },
          parcelId: "1073",
          sheetId: "SD6352",
        },
      ],
    },
    payments: {
      agreement: [
        {
          annualPaymentPence: 27200,
          code: "CMOR1",
          description: "Assess moorland and produce a written record",
          durationYears: 1,
          paymentRates: 27200,
        },
      ],
      parcel: [
        {
          actions: [
            {
              annualPaymentPence: 722510,
              appliedFor: { quantity: 681.6133, unit: "ha" },
              code: "CMOR1",
              description: "Assess moorland and produce a written record",
              durationYears: 1,
              eligible: { quantity: 681.6133, unit: "ha" },
              paymentRates: 1060,
            },
          ],
          area: { quantity: 681.6199, unit: "ha" },
          parcelId: "6060",
          sheetId: "SD5949",
        },
        {
          actions: [
            {
              annualPaymentPence: 72728,
              appliedFor: { quantity: 13.7223, unit: "ha" },
              code: "UPL2",
              description: "Low livestock grazing on moorland",
              durationYears: 1,
              eligible: { quantity: 13.7223, unit: "ha" },
              paymentRates: 5300,
            },
          ],
          area: { quantity: 13.7223, unit: "ha" },
          parcelId: "1073",
          sheetId: "SD6352",
        },
      ],
    },
    rulesCalculations: {
      date: "2026-02-12T09:29:00.297Z",
      id: 3,
      message: "Application validated successfully",
      valid: true,
    },
    scheme: "SFI",
    totalAnnualPaymentPence: 822438,
  },
  metadata: {
    clientRef: "44e-85c-692",
    crn: "1102760349",
    frn: "2396577132",
    sbi: "121428499",
    submittedAt: "2026-02-12T09:29:00.297Z",
  },
};

const woodlandApplicationBody = {
  answers: {
    appLandHasExistingWmp: true,
    applicant: {
      business: {
        address: {
          city: "Coventry",
          line1: "69 Church Lane",
          line2: "Barns",
          line3: "Coventry",
          line4: "Lancashire",
          line5: "",
          postalCode: "LN19 9JR",
          street: "Church Lane",
        },
        email: { address: "contact+300000068@example.test" },
        name: "Elm Acres",
        phone: { mobile: "07300000068" },
        reference: "0300000068",
      },
      customer: {
        name: { first: "Ruby", last: "Reed", middle: "David", title: "Mr" },
      },
    },
    applicationConfirmation: true,
    businessDetailsUpToDate: true,
    centreGridReference: "NG12345678",
    detailsConfirmedAt: "2026-05-05T08:51:55.586Z",
    existingWmps: "1234",
    fcTeamCode: "EAST_AND_EAST_MIDLANDS",
    guidanceRead: true,
    hectaresTenOrOverYearsOld: 2,
    hectaresUnderTenYearsOld: 2,
    includedAllEligibleWoodland: true,
    intendToApplyHigherTier: true,
    landHasGrazingRights: true,
    landManagementControl: true,
    landParcels: [
      { areaHa: 2.2142, parcelId: "SD8460-6537" },
      { areaHa: 3.3466, parcelId: "SD6350-6541" },
      { areaHa: 4.8834, parcelId: "SD5361-6542" },
    ],
    landRegisteredWithRpa: true,
    payments: {
      agreement: [
        {
          activePaymentTier: 1,
          activeTierFlatRatePence: 150000,
          activeTierRatePence: 0,
          agreementTotalPence: 150000,
          code: "PA3",
          description: "Woodland management plan",
          quantity: 2.8,
          quantityInActiveTier: 2.8,
          unit: "ha",
        },
      ],
    },
    publicBodyTenant: true,
    tenantObligations: false,
    totalAgreementPaymentPence: 150000,
    totalHectaresForSelectedParcels: 10.4442,
    woodlandName: "dfsfds",
  },
  metadata: {
    clientRef: "44e-85c-692",
    crn: "1102760349",
    frn: "2396577132",
    sbi: "121428499",
    submittedAt: "2026-02-12T09:29:00.297Z",
  },
};

describe("grants-ui Consumer (sends HTTP requests to fg-gas-backend)", () => {
  describe("GET application status", () => {
    it("should return 404 for a non-existent application", async () => {
      await pact
        .given("frps-private-beta is configured in fg-gas-backend")
        .uponReceiving("a request for a non-existent application status")
        .withRequest({
          method: "GET",
          path: "/grants/frps-private-beta/applications/non-existent-ref/status",
          headers: requestHeaders,
        })
        .willRespondWith({
          status: 404,
          headers: { "Content-Type": "application/json" },
          body: {
            error: "Not Found",
            message: like(
              'Application with clientRef "non-existent-ref" and code "frps-private-beta" not found',
            ),
            statusCode: 404,
          },
        })
        .executeTest(async (mockServer) => {
          const res = await fetch(
            `${mockServer.url}/grants/frps-private-beta/applications/non-existent-ref/status`,
            {
              headers: {
                Authorization: `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
              },
            },
          );
          // Pact asserts the response shape; we just need the request to complete
          await res.json();
        });
    });

    it("should return the status for a known frps-private-beta application", async () => {
      await pact
        .given(
          "frps-private-beta is configured in fg-gas-backend with a client reference 710-877-8fd",
        )
        .uponReceiving(
          "a request to get the status of an frps-private-beta application with client reference 710-877-8fd",
        )
        .withRequest({
          method: "GET",
          path: "/grants/frps-private-beta/applications/710-877-8fd/status",
          headers: requestHeaders,
        })
        .willRespondWith({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            status: like("RECEIVED"),
          },
        })
        .executeTest(async (mockServer) => {
          const res = await fetch(
            `${mockServer.url}/grants/frps-private-beta/applications/710-877-8fd/status`,
            {
              headers: {
                Authorization: `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
              },
            },
          );
          await res.json();
        });
    });
  });

  describe("POST applications", () => {
    it("should accept an frps-private-beta application", async () => {
      await pact
        .given("frps-private-beta is configured in fg-gas-backend")
        .uponReceiving("an frps-private-beta application")
        .withRequest({
          method: "POST",
          path: "/grants/frps-private-beta/applications",
          headers: requestHeaders,
          body: frpsApplicationBody,
        })
        .willRespondWith({ status: 204 })
        .executeTest(async (mockServer) => {
          await fetch(`${mockServer.url}/grants/frps-private-beta/applications`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${BEARER_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(frpsApplicationBody),
          });
        });
    });

    it("should accept an frps-private-beta application with only required properties", async () => {
      const minimalBody = {
        answers: {
          applicant: {
            business: {
              address: {
                city: "Clitheroe",
                line1: "Catlow Road",
                line2: "Groovy Park",
                postalCode: "BB7 4LQ",
              },
              name: "John Woodcock",
            },
            customer: {
              name: { first: "Antony", last: "Williams", title: "Mr." },
            },
          },
          application: {
            agreement: [],
            parcel: [
              {
                actions: [{ code: "CMOR1", durationYears: 1, version: "1.0.0" }],
                parcelId: "6060",
                sheetId: "SD5949",
              },
              {
                actions: [{ code: "UPL2", durationYears: 1, version: "2.0.0" }],
                parcelId: "1073",
                sheetId: "SD6352",
              },
            ],
          },
          payments: {
            agreement: [{ code: "CMOR1" }],
            parcel: [
              {
                actions: [{ code: "CMOR1" }],
                parcelId: "6060",
                sheetId: "SD5949",
              },
              {
                actions: [{ code: "UPL2" }],
                parcelId: "1073",
                sheetId: "SD6352",
              },
            ],
          },
          rulesCalculations: {
            date: "2026-02-12T09:29:00.297Z",
            id: 3,
            message: "Application validated successfully",
            valid: true,
          },
          scheme: "SFI",
        },
        metadata: {
          clientRef: "c0c-e5c-017",
          crn: "1102760349",
          frn: "2396577132",
          sbi: "121428499",
          submittedAt: "2026-02-12T09:29:00.297Z",
        },
      };

      await pact
        .given("frps-private-beta is configured in fg-gas-backend")
        .uponReceiving("an frps-private-beta application with only required properties")
        .withRequest({
          method: "POST",
          path: "/grants/frps-private-beta/applications",
          headers: requestHeaders,
          body: minimalBody,
        })
        .willRespondWith({ status: 204 })
        .executeTest(async (mockServer) => {
          await fetch(`${mockServer.url}/grants/frps-private-beta/applications`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${BEARER_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(minimalBody),
          });
        });
    });

    it("should accept an amendment application", async () => {
      const amendmentBody = {
        ...frpsApplicationBody,
        metadata: {
          ...frpsApplicationBody.metadata,
          clientRef: "55f-12a-999",
          previousClientRef: "44e-85c-692",
        },
      };

      await pact
        .given("frps-private-beta is configured in fg-gas-backend")
        .uponReceiving("an amendment application")
        .withRequest({
          method: "POST",
          path: "/grants/frps-private-beta/applications",
          headers: requestHeaders,
          body: amendmentBody,
        })
        .willRespondWith({ status: 204 })
        .executeTest(async (mockServer) => {
          await fetch(`${mockServer.url}/grants/frps-private-beta/applications`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${BEARER_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(amendmentBody),
          });
        });
    });

    it("should accept a valid woodland application", async () => {
      await pact
        .given("woodland is configured in fg-gas-backend")
        .uponReceiving("a woodland application")
        .withRequest({
          method: "POST",
          path: "/grants/woodland/applications",
          headers: requestHeaders,
          body: woodlandApplicationBody,
        })
        .willRespondWith({ status: 204 })
        .executeTest(async (mockServer) => {
          await fetch(`${mockServer.url}/grants/woodland/applications`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${BEARER_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(woodlandApplicationBody),
          });
        });
    });

    it("should reject a woodland application with invalid hectares", async () => {
      const invalidBody = {
        ...woodlandApplicationBody,
        answers: {
          ...woodlandApplicationBody.answers,
          hectaresTenOrOverYearsOld: 0.1,
        },
      };

      await pact
        .given("woodland validation fails due to invalid hectares")
        .uponReceiving("a woodland application with invalid hectares")
        .withRequest({
          method: "POST",
          path: "/grants/woodland/applications",
          headers: requestHeaders,
          body: invalidBody,
        })
        .willRespondWith({
          status: 400,
          headers: { "Content-Type": "application/json" },
          body: {
            error: "Bad Request",
            message: like("Some validation error"),
            statusCode: 400,
          },
        })
        .executeTest(async (mockServer) => {
          await fetch(`${mockServer.url}/grants/woodland/applications`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${BEARER_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(invalidBody),
          });
        });
    });
  });
});
