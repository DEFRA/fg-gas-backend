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
                    sbi: "900000005",
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
                          first: "Jamie",
                          middle: "Test",
                          last: "Sample",
                        },
                      },
                      business: {
                        name: "Example Ridge Farm Ltd",
                        address: {
                          line1: "3 Example Lane",
                          line2: "Example Village",
                          line3: null,
                          line4: null,
                          line5: null,
                          street: "Example Lane",
                          city: "Exampleton",
                          postalCode: "ZZ99 3ZZ",
                        },
                      },
                    },
                    application: {
                      _id: "f00000000000000000000001",
                      agreement: [],
                      parcel: [
                        {
                          _id: "f00000000000000000000002",
                          parcelId: "0006",
                          sheetId: "AA0006",
                          area: {
                            _id: "f00000000000000000000003",
                            quantity: 5.2182,
                            unit: "ha",
                          },
                          actions: [
                            {
                              _id: "f00000000000000000000004",
                              code: "CMOR1",
                              version: 1,
                              durationYears: 3,
                              appliedFor: {
                                _id: "f00000000000000000000005",
                                quantity: 4.7575,
                                unit: "ha",
                              },
                            },
                          ],
                        },
                        {
                          _id: "f00000000000000000000006",
                          parcelId: "0007",
                          sheetId: "AA0006",
                          area: {
                            _id: "f00000000000000000000007",
                            quantity: 2.1703,
                            unit: "ha",
                          },
                          actions: [
                            {
                              _id: "f00000000000000000000008",
                              code: "CMOR1",
                              version: 1,
                              durationYears: 3,
                              appliedFor: {
                                _id: "f00000000000000000000009",
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
                          parcelId: "0006",
                          sheetId: "AA0006",
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

  describe("UpdateAgreementStatusCommand Provider Verification", () => {
    it("should verify GAS sends UpdateAgreementStatusCommand matching Agreement Service expectations", async () => {
      const messagePact = new MessageProviderPact({
        messageProviders: {
          "an agreement withdrawn message": () => {
            return {
              contents: {
                id: "99887766-5544-3322-1100-998877665544",
                source: "fg-gas-backend",
                specversion: "1.0",
                type: "cloud.defra.test.fg-gas-backend.agreement.status.update",
                datacontenttype: "application/json",
                time: "2025-12-15T10:19:06.519Z",
                data: {
                  clientRef: "client-ref-002",
                  agreementNumber: "FPTT123456789",
                  status: "Withdrawn",
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
