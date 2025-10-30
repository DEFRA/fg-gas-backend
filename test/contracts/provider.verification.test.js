import { Verifier } from "@pact-foundation/pact";
import dotenv from "dotenv";
import { env } from "node:process";
import { describe, it } from "vitest";

// Load .env file for PACT_BROKER credentials
dotenv.config();

describe("fg-gas-backend Provider Verification", () => {
  // Use staging service URL for self-hosted runner, localhost for development
  const PROVIDER_BASE_URL = env.PROVIDER_BASE_URL || `http://localhost:3001`;

  console.log("Provider Base URL:", PROVIDER_BASE_URL);

  describe("Contract Verification", () => {
    it("should verify contracts from grants-ui consumer", async () => {
      // Debug environment variables
      console.log("Environment check:");
      console.log("- PROVIDER_BASE_URL:", env.PROVIDER_BASE_URL || "[NOT SET]");
      console.log("- PACT_USER:", env.PACT_USER ? "[SET]" : "[NOT SET]");
      console.log("- PACT_PASS:", env.PACT_PASS ? "[SET]" : "[NOT SET]");
      console.log("- Using Provider URL:", PROVIDER_BASE_URL);

      const opts = {
        provider: "fg-gas-backend",
        providerBaseUrl: PROVIDER_BASE_URL,
        pactBrokerUrl:
          env.PACT_BROKER_BASE_URL ||
          "https://ffc-pact-broker.azure.defra.cloud",
        consumerVersionSelectors: [{ latest: true }],
        pactBrokerUsername: env.PACT_USER,
        pactBrokerPassword: env.PACT_PASS,
        stateHandlers: {
          // Mocked state handlers - staging environment should have required data
          "example-grant-with-auth-v3 is configured in fg-gas-backend":
            async () => {
              console.log(
                "State: example-grant-with-auth-v3 is configured (staging environment)",
              );
              // Staging environment should have the required grant configured
              // No database setup needed - service should handle this internally
              return Promise.resolve();
            },

          "adding value grant scheme is available": async () => {
            console.log(
              "State: adding value grant scheme is available (staging environment)",
            );
            return Promise.resolve();
          },

          "adding value grant has minimum cost threshold": async () => {
            console.log(
              "State: grant has minimum cost threshold (staging environment)",
            );
            return Promise.resolve();
          },

          "application submission service is available": async () => {
            console.log(
              "State: application submission service is available (staging environment)",
            );
            return Promise.resolve();
          },

          "application validation is enforced": async () => {
            console.log(
              "State: application validation is enforced (staging environment)",
            );
            return Promise.resolve();
          },

          "application AV-2024-001 exists and is under review": async () => {
            console.log(
              "State: application AV-2024-001 exists (staging environment)",
            );
            return Promise.resolve();
          },

          "application AV-2024-999 does not exist": async () => {
            console.log(
              "State: application AV-2024-999 does not exist (staging environment)",
            );
            return Promise.resolve();
          },

          "grants are available in the system": async () => {
            console.log(
              "State: grants are available in the system (staging environment)",
            );
            return Promise.resolve();
          },

          "grant frps-private-beta exists": async () => {
            console.log(
              "State: grant frps-private-beta exists (staging environment)",
            );
            return Promise.resolve();
          },

          "grant system is available for application submission": async () => {
            console.log(
              "State: grant system is available for application submission (staging environment)",
            );
            return Promise.resolve();
          },

          "grant system validates grant codes": async () => {
            console.log(
              "State: grant system validates grant codes (staging environment)",
            );
            return Promise.resolve();
          },

          "application with clientRef duplicate-ref-123 already exists":
            async () => {
              console.log(
                "State: application with duplicate clientRef exists (staging environment)",
              );
              return Promise.resolve();
            },

          "application AV240115001 is approved and ready for agreement":
            async () => {
              console.log(
                "State: application approved and ready for agreement (staging environment)",
              );
              return Promise.resolve();
            },

          "application AV240199999 does not exist": async () => {
            console.log(
              "State: application AV240199999 does not exist (staging environment)",
            );
            return Promise.resolve();
          },

          "application AV240116001 exists but is still under review":
            async () => {
              console.log(
                "State: application under review (staging environment)",
              );
              return Promise.resolve();
            },

          "application AV240115001 is approved": async () => {
            console.log("State: application is approved (staging environment)");
            return Promise.resolve();
          },

          "application AV240115001 has detailed parcel information":
            async () => {
              console.log(
                "State: application has detailed parcel information (staging environment)",
              );
              return Promise.resolve();
            },
        },
        requestFilter: (req, _res, next) => {
          // Add authentication headers if needed for staging environment
          if (!req.headers.authorization) {
            req.headers.authorization = "Bearer test-token";
          }
          next();
        },
        customProviderHeaders: ["Authorization: Bearer test-token"],
        publishVerificationResult: true, // Publish results back to Pact Broker
        providerVersion: process.env.GIT_COMMIT || "1.0.0",
      };

      return new Verifier(opts).verifyProvider();
    });
  });
});
