// test/contract/provider.cw-backend.test.js
// Provider test: Verify fg-gas-backend sends messages that match fg-cw-backend's expectations
//
// This test verifies that CreateNewCaseCommand and UpdateCaseStatusCommand messages
// produced by GAS match what CW expects (defined in CW's consumer.gas-backend.test.js)
//
import {
  MessageProviderPact,
  providerWithMetadata,
} from "@pact-foundation/pact";
import { describe, it, vi } from "vitest";

import { CreateNewCaseCommand } from "../../src/grants/commands/create-new-case.command.js";
import { UpdateCaseStatusCommand } from "../../src/grants/commands/update-case-status.command.js";
import { buildMessageVerifierOptions } from "./messageVerifierConfig.js";

// Mock config before importing production code
vi.mock("../../src/common/config.js", () => ({
  config: {
    serviceName: "fg-gas-backend",
    environment: "test",
  },
}));

describe("GAS Provider (sends messages to CW)", () => {
  describe("CreateNewCaseCommand Provider Verification", () => {
    it("should verify GAS sends CreateNewCaseCommand matching CW expectations", async () => {
      const messagePact = new MessageProviderPact({
        messageProviders: {
          "a create new case command from GAS": () => {
            // Create a mock application object that represents what would be passed to the command
            const mockApplication = {
              clientRef: "CASE-REF-001",
              code: "frps-private-beta",
              createdAt: "2025-02-09T11:00:00.000Z",
              submittedAt: "2025-02-09T12:00:00.000Z",
              identifiers: {
                sbi: "SBI001",
                frn: "FIRM0001",
                crn: "CUST0001",
                defraId: "DEFRA0001",
              },
              metadata: {},
              getAnswers() {
                return {
                  scheme: "SFI",
                  year: 2025,
                  hasCheckedLandIsUpToDate: true,
                  rulesCalculations: {
                    id: 421,
                    message: "Application validated successfully",
                    valid: true,
                    date: "2025-11-18T13:51:50.549Z",
                  },
                  applicant: {
                    business: {
                      name: "VAUGHAN FARMS LIMITED",
                      reference: "3989509178",
                      email: {
                        address: "test@example.com",
                      },
                      phone: "01234031670",
                      address: {
                        line1: "Mason House Farm Clitheroe Rd",
                        line2: "Bashall Eaves",
                        street: "Bartindale Road",
                        city: "Clitheroe",
                        postalCode: "BB7 3DD",
                      },
                    },
                    customer: {
                      name: {
                        title: "Mr.",
                        first: "Edward",
                        middle: "Paul",
                        last: "Jones",
                      },
                    },
                  },
                  totalAnnualPaymentPence: 28062,
                  application: {
                    parcel: [
                      {
                        sheetId: "SD6843",
                        parcelId: "9485",
                        area: {
                          unit: "ha",
                          quantity: 0.1447,
                        },
                        actions: [
                          {
                            code: "CMOR1",
                            version: 1,
                            durationYears: 3,
                            appliedFor: {
                              unit: "ha",
                              quantity: 0.1447,
                            },
                          },
                        ],
                      },
                    ],
                    agreement: [],
                  },
                  payments: {
                    parcel: [
                      {
                        sheetId: "SD6843",
                        parcelId: "9485",
                        area: {
                          unit: "ha",
                          quantity: 0.1447,
                        },
                        actions: [
                          {
                            code: "CMOR1",
                            description:
                              "Assess moorland and produce a written record",
                            durationYears: 3,
                            paymentRates: 1060,
                            annualPaymentPence: 153,
                            eligible: {
                              unit: "ha",
                              quantity: 0.1447,
                            },
                            appliedFor: {
                              unit: "ha",
                              quantity: 0.1447,
                            },
                          },
                        ],
                      },
                    ],
                  },
                };
              },
            };

            // Create the actual message using production code
            const command = new CreateNewCaseCommand(mockApplication);

            // Return the message content that will be verified against the pact
            return providerWithMetadata(command, {
              contentType: "application/json",
            });
          },
        },
      });

      // Verify against the pact file from broker (or local if PACT_USE_LOCAL=true)
      const verifyOpts = buildMessageVerifierOptions({
        providerName: "fg-gas-backend",
        consumerName: "fg-cw-backend",
      });

      return messagePact.verify(verifyOpts);
    });
  });

  describe("CreateNewCaseCommand Provider Verification (without optional fields)", () => {
    it("should verify GAS sends CreateNewCaseCommand without optional fields matching CW expectations", async () => {
      const messagePact = new MessageProviderPact({
        messageProviders: {
          "a create new case command from GAS without optional fields": () => {
            const mockApplication = {
              clientRef: "CASE-REF-002",
              code: "frps-private-beta",
              createdAt: "2025-02-09T11:00:00.000Z",
              submittedAt: "2025-02-09T12:00:00.000Z",
              identifiers: {
                sbi: "SBI002",
                frn: "FIRM0002",
                crn: "CUST0002",
              },
              getAnswers() {
                return {
                  scheme: "SFI",
                  year: 2025,
                  hasCheckedLandIsUpToDate: true,
                };
              },
            };

            const command = new CreateNewCaseCommand(mockApplication);

            return providerWithMetadata(command, {
              contentType: "application/json",
            });
          },
        },
      });

      const verifyOpts = buildMessageVerifierOptions({
        providerName: "fg-gas-backend",
        consumerName: "fg-cw-backend",
      });

      return messagePact.verify(verifyOpts);
    });
  });

  describe("UpdateCaseStatusCommand Provider Verification", () => {
    it("should verify GAS sends UpdateCaseStatusCommand matching CW expectations", async () => {
      const messagePact = new MessageProviderPact({
        messageProviders: {
          "a case status update command from GAS": () => {
            // Create the actual message using production code
            const command = new UpdateCaseStatusCommand({
              caseRef: "CASE-REF-001",
              workflowCode: "frps-private-beta",
              newStatus: "PRE_AWARD:ASSESSMENT:IN_REVIEW",
              phase: "PRE_AWARD",
              stage: "ASSESSMENT",
              targetNode: "agreements",
              dataType: "ARRAY",
              data: [
                {
                  agreementRef: "AGR-001",
                  createdAt: "2023-10-01T12:00:00Z",
                  updatedAt: "2023-10-01T12:00:00Z",
                  agreementStatus: "OFFER",
                },
              ],
            });

            // Return the message content that will be verified against the pact
            return providerWithMetadata(command, {
              contentType: "application/json",
            });
          },
        },
      });

      // Verify against the pact file from broker (or local if PACT_USE_LOCAL=true)
      const verifyOpts = buildMessageVerifierOptions({
        providerName: "fg-gas-backend",
        consumerName: "fg-cw-backend",
      });

      return messagePact.verify(verifyOpts);
    });
  });

  describe("UpdateCaseStatusCommand Provider Verification (without optional supplementary data fields)", () => {
    it("should verify GAS sends UpdateCaseStatusCommand with minimal supplementary data matching CW expectations", async () => {
      const messagePact = new MessageProviderPact({
        messageProviders: {
          "a case status update command from GAS without optional supplementary data fields":
            () => {
              const command = new UpdateCaseStatusCommand({
                caseRef: "CASE-REF-002",
                workflowCode: "frps-private-beta",
                newStatus: "PRE_AWARD:ASSESSMENT:IN_REVIEW",
                phase: "PRE_AWARD",
                stage: "ASSESSMENT",
              });

              return providerWithMetadata(command, {
                contentType: "application/json",
              });
            },
        },
      });

      const verifyOpts = buildMessageVerifierOptions({
        providerName: "fg-gas-backend",
        consumerName: "fg-cw-backend",
      });

      return messagePact.verify(verifyOpts);
    });
  });
});
