import { MessageProviderPact } from "@pact-foundation/pact";
import { describe, it } from "vitest";
import { buildMessageVerifierOptions } from "./messageVerifierConfig.js";

describe("GAS Provider (sends messages to Agreement Service)", () => {
  describe("CreateAgreementCommand Provider Verification", () => {
    it("should verify GAS sends CreateAgreementCommand matching Agreement Service expectations", async () => {
      const messagePact = new MessageProviderPact({
        messageProviders: {
          "agreement created event - an agreement created message": () => {
            return {
              contents: {
                id: "12345678-1234-1234-1234-123456789012",
                source: "fg-gas-backend",
                specversion: "1.0",
                type: "cloud.defra.test.fg-gas-backend.agreement.create",
                datacontenttype: "application/json",
                time: "2025-12-15T10:19:06.519Z",
                data: {
                  agreementNumber: "FPTT987654321",
                  clientRef: "client-ref-002",
                  code: "frps-private-beta",
                  createdAt: "2025-08-19T09:36:45.131Z",
                  submittedAt: "2025-08-19T09:36:44.509Z",
                  notificationMessageId: "sample-notification-2",
                  identifiers: {
                    sbi: "106284736",
                    frn: "frn",
                    crn: "crn",
                  },
                  answers: {
                    scheme: "FPTT",
                    year: 2025,
                    agreementName: "Example agreement 2",
                    hasCheckedLandIsUpToDate: true,
                    applicant: {
                      customer: {
                        name: {
                          title: "Mr.",
                          first: "Edward",
                          middle: "Paul",
                          last: "Jones",
                        },
                      },
                      business: {
                        name: "J&S Hartley",
                        address: {
                          line1: "Mason House Farm Clitheroe Rd",
                          line2: "Bashall Eaves",
                          line3: null,
                          line4: null,
                          line5: null,
                          street: "Bartindale Road",
                          city: "Clitheroe",
                          postalCode: "BB7 3DD",
                        },
                      },
                    },
                    application: {
                      _id: "69262bb2331fd3b45b76ee90",
                      agreement: [],
                      parcel: [
                        {
                          _id: "69262bb2331fd3b45b76ee91",
                          parcelId: "8083",
                          sheetId: "SD6743",
                          area: {
                            _id: "69262bb2331fd3b45b76ee92",
                            quantity: 5.2182,
                            unit: "ha",
                          },
                          actions: [
                            {
                              _id: "69262bb2331fd3b45b76ee93",
                              code: "CMOR1",
                              version: 1,
                              durationYears: 3,
                              appliedFor: {
                                _id: "69262bb2331fd3b45b76ee94",
                                quantity: 4.7575,
                                unit: "ha",
                              },
                            },
                          ],
                        },
                        {
                          _id: "69262bb2331fd3b45b76ee97",
                          parcelId: "8333",
                          sheetId: "SD6743",
                          area: {
                            _id: "69262bb2331fd3b45b76ee98",
                            quantity: 2.1703,
                            unit: "ha",
                          },
                          actions: [
                            {
                              _id: "69262bb2331fd3b45b76ee99",
                              code: "CMOR1",
                              version: 1,
                              durationYears: 3,
                              appliedFor: {
                                _id: "69262bb2331fd3b45b76ee9a",
                                quantity: 2.1705,
                                unit: "ha",
                              },
                            },
                          ],
                        },
                      ],
                    },
                    payment: {
                      agreementStartDate: "2025-09-01",
                      agreementEndDate: "2028-09-01",
                      frequency: "Quarterly",
                      annualTotalPence: 32006,
                      agreementTotalPence: 96018,
                      agreementLevelItems: {
                        1: {
                          code: "CMOR1",
                          version: 1,
                          description:
                            "CMOR1: Assess moorland and produce a written record",
                          annualPaymentPence: 27200,
                        },
                      },
                      parcelItems: {
                        1: {
                          code: "CMOR1",
                          version: 1,
                          description:
                            "CMOR1: Assess moorland and produce a written record",
                          parcelId: "8083",
                          sheetId: "SD6743",
                          quantity: 4.53411078,
                          unit: "ha",
                          rateInPence: 1060,
                          annualPaymentPence: 4806,
                        },
                      },
                      payments: [
                        {
                          paymentDate: "2025-12-05",
                          totalPaymentPence: 8007,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1204,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6803,
                            },
                          ],
                        },
                        {
                          paymentDate: "2026-03-05",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2026-06-05",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2026-09-07",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2026-12-07",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2027-03-05",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2027-06-07",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2027-09-06",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2027-12-06",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2028-03-06",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2028-06-05",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                        {
                          paymentDate: "2028-09-05",
                          totalPaymentPence: 8001,
                          lineItems: [
                            {
                              parcelItemId: 1,
                              paymentPence: 1201,
                            },
                            {
                              agreementLevelItemId: 1,
                              paymentPence: 6800,
                            },
                          ],
                        },
                      ],
                    },
                    actionApplications: [],
                  },
                },
              },
            };
          },
        },
      });

      const verifyOpts = buildMessageVerifierOptions({
        providerName: "fg-gas-backend",
        consumerName: "farming-grants-agreements-api",
      });

      return messagePact.verify(verifyOpts);
    });
  });

  describe("ApplicationStatusUpdatedEvent Provider Verification", () => {
    it("should verify GAS sends ApplicationStatusUpdatedEvent matching Agreement Service expectations", async () => {
      const messagePact = new MessageProviderPact({
        messageProviders: {
          "application status updated event - an application status updated message":
            () => {
              return {
                contents: {
                  id: "87654321-4321-4321-4321-210987654321",
                  source: "fg-gas-backend",
                  specversion: "1.0",
                  type: "cloud.defra.test.fg-gas-backend.application.status.updated",
                  datacontenttype: "application/json",
                  time: "2025-12-15T10:19:06.519Z",
                  data: {
                    clientRef: "client-ref-002",
                    grantCode: "frps-private-beta",
                    previousStatus:
                      "PRE_AWARD:APPLICATION:APPLICATION_RECEIVED",
                    currentStatus: "PRE_AWARD:APPLICATION:WITHDRAWAL_REQUESTED",
                  },
                },
              };
            },
        },
      });

      const verifyOpts = buildMessageVerifierOptions({
        providerName: "fg-gas-backend",
        consumerName: "farming-grants-agreements-api",
      });

      return messagePact.verify(verifyOpts);
    });
  });
});
