import { assertValidAgreementDefinitions } from "./agreement-definition.schema.js";

const agreementDefinitions = new Map([
  [
    "pigs-might-fly",
    {
      code: "pigs-might-fly",
      configVersion: "0.0.1",
      agreementNumberPrefix: "PMF",
      create: {
        target: "offered",
        effects: [
          {
            name: "callEndpoint",
            output: "fundingCalculation",
            params: {
              endpoint: {
                code: "calculate-funding",
                endpointParams: {
                  BODY: {
                    pigTypes: [
                      {
                        pigType: "largeWhite",
                        quantity: "$.answers.whitePigsCount ?? 0",
                      },
                      {
                        pigType: "britishLandrace",
                        quantity: "$.answers.britishLandracePigsCount ?? 0",
                      },
                      {
                        pigType: "berkshire",
                        quantity: "$.answers.berkshirePigsCount ?? 0",
                      },
                      {
                        pigType: "other",
                        quantity: "$.answers.otherPigsCount ?? 0",
                      },
                    ],
                  },
                },
              },
            },
          },
          {
            name: "snapshot",
            params: {
              fundingCalculation: "$.outputs.fundingCalculation",
            },
          },
        ],
      },
      states: {
        offered: {
          on: {
            accept: {
              target: "accepted",
              validation: {
                page: "accept",
                required: [
                  {
                    name: "confirm",
                    value: "confirmed",
                    href: "#confirm",
                    message: "Confirm this agreement offer before accepting it",
                  },
                ],
              },
              effects: [
                {
                  name: "createPaymentClaim",
                  output: "paymentClaim",
                  params: {
                    payment: "$.item.payload.answers.payment",
                    fundingCalculation:
                      "$.previousItemState.fundingCalculation",
                    mapping: {
                      itemAmount: "$.total",
                      itemDescription: "$.description",
                      itemKey: "$.type",
                      items: "$.items",
                      total: "$.grandTotal",
                    },
                    schedule: {
                      durationMonths: 12,
                      paymentOffsetMonths: 1,
                      start: "firstDayOfNextMonth",
                    },
                    paymentClaim: {
                      defaultCurrency: "GBP",
                      deliveryBody: "RP00",
                      invoiceNumber: {
                        requestPadding: 3,
                        requestPrefix: "V",
                        suffix: "QX",
                      },
                      lineItemTypes: [
                        {
                          descriptionTemplate:
                            "{paymentDate}: Parcel: {item.parcelId}: {item.description}",
                          idField: "parcelItemId",
                          itemsPath: "parcelItems",
                          schemeCodePath: "item.code",
                        },
                        {
                          descriptionTemplate:
                            "{paymentDate}: One-off payment per agreement per year for {item.description}",
                          idField: "agreementLevelItemId",
                          itemsPath: "agreementLevelItems",
                          schemeCodePath: "item.code",
                        },
                      ],
                      marketingYear: "currentYear",
                      paymentRequestNumber: 1,
                      scheme: "SFI",
                      sourceSystem: "FPTT",
                    },
                  },
                },
                {
                  name: "snapshot",
                  params: {
                    acceptedAt: "$.executedAt",
                    acceptedBy: "$.command.acceptedBy",
                    claimId: "$.outputs.paymentClaim.claimId",
                    correlationId: "$.outputs.paymentClaim.correlationId",
                    originalInvoiceNumber:
                      "$.outputs.paymentClaim.originalInvoiceNumber",
                    payment: "$.outputs.paymentClaim.payment",
                  },
                },
                {
                  name: "publish",
                  params: {
                    event: "lifecycle",
                  },
                },
              ],
            },
          },
        },
        accepted: {},
      },
      pages: {
        offered: {
          title: "Review your agreement offer",
          components: [
            {
              component: "heading",
              level: 1,
              text: "Review your agreement offer",
            },
            {
              component: "paragraph",
              text: "If you accept this agreement offer, the resulting agreement will be between Defra and:",
            },
            {
              component: "paragraph",
              classes: "govuk-body govuk-!-font-weight-bold",
              items: [
                {
                  component: "text",
                  text: "$.item.payload.answers.businessName",
                },
                {
                  component: "line-break",
                },
                {
                  component: "text",
                  text: "SBI: $.agreement.sbi",
                },
              ],
            },
            {
              component: "paragraph",
              text: "Your agreement start date will be the 1st of the month after the agreement is signed.",
            },
            {
              component: "heading",
              level: 2,
              text: "Payments",
            },
            {
              component: "paragraph",
              text: "If you accept this agreement offer, you will receive a one-off payment for the Pigs Might Fly agreement.",
            },
            {
              component: "table",
              head: [{ text: "Pig Type" }, { text: "Amount" }],
              rowsRef:
                "jsonata:$filter($exists($.item.fundingCalculation.items) ? $.item.fundingCalculation.items : $each($.item.payload.answers.payment.agreementLevelItems, function($value) { $value }), function($item) { ($exists($item.total) ? $item.total : $item.annualPaymentPence) > 0 })",
              rows: [
                { text: "@.description" },
                {
                  text: "jsonata:$exists(@.total) ? @.total * 100 : @.annualPaymentPence",
                  format: "poundsNoDecimals",
                },
              ],
            },
            {
              component: "details",
              summaryItems: [
                {
                  text: "If you need to make an update",
                },
              ],
              items: [
                {
                  component: "paragraph",
                  text: "Contact the Rural Payments Agency (RPA) if you have a query.",
                },
              ],
            },
          ],
          actions: [
            {
              href: {
                urlTemplate: "/{agreementNumber}/accept",
                params: {
                  agreementNumber: "$.agreement.agreementNumber",
                },
              },
              text: "Continue",
            },
          ],
        },
        accept: {
          title: "Accept your agreement offer",
          components: [
            {
              component: "heading",
              level: 1,
              text: "Accept your agreement offer",
            },
            {
              component: "paragraph",
              text: "Your agreement will consist of the draft agreement document and the Capital grants agreements: terms and conditions.",
            },
            {
              component: "paragraph",
              text: "By accepting this offer, you confirm you will comply with the obligations under your agreement.",
            },
          ],
          actions: [
            {
              action: {
                urlTemplate: "/{agreementNumber}/actions/accept",
                params: {
                  agreementNumber: "$.agreement.agreementNumber",
                },
              },
              checkbox: {
                name: "confirm",
                value: "confirmed",
                text: "I confirm I have read the information in this section and accept this agreement offer.",
              },
              fields: [
                { name: "code", value: "$.agreement.code" },
                { name: "clientRef", value: "$.item.clientRef" },
                { name: "acceptedBy", value: "applicant" },
              ],
              text: "Accept agreement offer",
            },
          ],
        },
        accepted: {
          title: "Offer accepted",
          components: [
            {
              component: "panel",
              title: "Agreement offer accepted",
              items: [
                {
                  component: "text",
                  text: "The start date for this agreement is",
                },
                {
                  component: "line-break",
                },
                {
                  component: "text",
                  text: "$.item.payment.agreementStartDate",
                  format: "formatLongDate",
                },
              ],
            },
            {
              component: "paragraph",
              text: "Your agreement number is $.agreement.agreementNumber.",
            },
            {
              component: "paragraph",
              text: "You can view:",
            },
            {
              component: "unordered-list",
              items: [
                {
                  component: "url",
                  text: "your agreement document",
                  href: {
                    urlTemplate: "/{agreementNumber}",
                    params: {
                      agreementNumber: "$.agreement.agreementNumber",
                    },
                  },
                  target: "_blank",
                },
                {
                  component: "url",
                  text: "the Capital grants agreements: terms and conditions 2026",
                  href: "https://www.gov.uk/government/publications/capital-grants-2026/capital-grants-2026-terms-and-conditions",
                },
              ],
            },
            {
              component: "heading",
              level: 2,
              text: "If you need help",
              classes: "govuk-heading-m",
            },
            {
              component: "paragraph",
              text: "Contact the Rural Payments Agency (RPA) by phone or email.",
            },
            {
              component: "paragraph",
              text: "Telephone: 03000 200 301",
            },
            {
              component: "paragraph",
              text: "Monday to Friday, 8:30am to 5pm (excluding bank holidays)",
            },
            {
              component: "paragraph",
              items: [
                {
                  component: "text",
                  text: "Email: ",
                },
                {
                  component: "url",
                  text: "ruralpayments@defra.gov.uk",
                  href: "mailto:ruralpayments@defra.gov.uk",
                },
              ],
            },
          ],
        },
        view: {
          title: "Pigs Might Fly agreement document",
          layout: "document",
          components: [
            {
              component: "notification-banner",
              condition: "jsonata:$.item.status = 'offered'",
              title: "This is a draft version of your agreement",
              items: [
                {
                  component: "paragraph",
                  text: "You will receive the final agreement once you accept your agreement offer.",
                },
                {
                  component: "paragraph",
                  items: [
                    {
                      component: "text",
                      text: "Your agreement will start on the first day of the month after you accept your offer and end on the agreement end date, subject to the provisions for early termination set out in the ",
                    },
                    {
                      component: "url",
                      href: "https://www.gov.uk/government/publications/capital-grants-agreements-terms-and-conditions-2026/capital-grants-agreements-terms-and-conditions-2026",
                      text: "Capital grants agreements: Terms and Conditions 2026",
                      target: "_blank",
                    },
                  ],
                },
              ],
            },
            {
              component: "notification-banner",
              condition: "jsonata:$.item.status = 'withdrawn'",
              title: "This agreement offer has been withdrawn.",
            },
            {
              component: "notification-banner",
              condition: "jsonata:$.item.status = 'cancelled'",
              title: "This agreement offer has been cancelled.",
            },
            {
              component: "notification-banner",
              condition: "jsonata:$.item.status = 'terminated'",
              title: "This agreement offer has been terminated.",
            },
            {
              component: "watermark",
              condition: "jsonata:$.item.status = 'offered'",
              header: "Draft Agreement",
              text: "DRAFT",
            },
            {
              component: "watermark",
              condition: "jsonata:$.item.status = 'withdrawn'",
              classes: "print-watermark--withdrawn",
              header: "Withdrawn Agreement",
              text: "WITHDRAWN",
            },
            {
              component: "watermark",
              condition: "jsonata:$.item.status = 'cancelled'",
              classes: "print-watermark--withdrawn",
              header: "Cancelled Agreement",
              text: "CANCELLED",
            },
            {
              component: "watermark",
              condition: "jsonata:$.item.status = 'terminated'",
              classes: "print-watermark--withdrawn",
              header: "Terminated Agreement",
              text: "TERMINATED",
            },
            {
              component: "heading",
              level: 1,
              text: "Pigs Might Fly agreement document",
            },
            {
              component: "summary-list",
              rows: [
                {
                  label: "Agreement holder",
                  text: "$.item.payload.answers.businessName",
                },
                {
                  label: "SBI",
                  text: "$.agreement.sbi",
                },
                {
                  label: "Agreement number",
                  text: "$.agreement.agreementNumber",
                },
                {
                  label: "Agreement start date",
                  text: "jsonata:($.item.status = 'offered' or $.item.status = 'withdrawn' or $.item.status = 'cancelled') ? 'XXXXX' : ($.item.payment.agreementStartDate ? $.item.payment.agreementStartDate : '')",
                },
                {
                  label: "Agreement end date",
                  text: "jsonata:($.item.status = 'offered' or $.item.status = 'withdrawn' or $.item.status = 'cancelled') ? 'XXXXX' : ($.item.payment.agreementEndDate ? $.item.payment.agreementEndDate : '')",
                },
              ],
            },
            {
              component: "heading",
              level: 2,
              text: "Payments",
            },
            {
              component: "paragraph",
              text: "The following table sets out the total payment for the Pigs Might Fly agreement.",
            },
            {
              component: "table",
              head: [{ text: "Pig Type" }, { text: "Amount" }],
              rowsRef:
                "jsonata:$filter($exists($.item.fundingCalculation.items) ? $.item.fundingCalculation.items : $each($.item.payload.answers.payment.agreementLevelItems, function($value) { $value }), function($item) { ($exists($item.total) ? $item.total : $item.annualPaymentPence) > 0 })",
              rows: [
                { text: "@.description" },
                {
                  text: "jsonata:$exists(@.total) ? @.total * 100 : @.annualPaymentPence",
                  format: "poundsNoDecimals",
                },
              ],
            },
            {
              component: "heading",
              id: "schedule",
              level: 2,
              text: "Agreement duration",
              condition: "jsonata:$.item.status = 'accepted'",
            },
            {
              component: "paragraph",
              text: "The agreement will commence on the agreement start date and end on the agreement end date, subject to the provisions for early termination set out in the terms and conditions.",
              condition: "jsonata:$.item.status = 'accepted'",
            },
            {
              component: "summary-list",
              condition: "jsonata:$.item.status = 'accepted'",
              rows: [
                {
                  label: "Agreement Start Date:",
                  text: "$.item.payment.agreementStartDate",
                  format: "formatDate",
                },
                {
                  label: "Agreement End Date:",
                  text: "$.item.payment.agreementEndDate",
                  format: "formatDate",
                },
              ],
            },
            {
              component: "heading",
              id: "signature",
              level: 2,
              text: "Electronic signature",
              condition: "jsonata:$.item.status = 'accepted'",
            },
            {
              component: "paragraph",
              condition: "jsonata:$.item.status = 'accepted'",
              items: [
                {
                  component: "text",
                  text: "The agreement comprising this agreement document, the terms and conditions and the payments has been accepted by ",
                },
                {
                  component: "text",
                  text: "$.item.payload.answers.businessName || $.item.acceptedBy",
                },
                {
                  component: "text",
                  text: " on ",
                },
                {
                  component: "text",
                  text: "$.item.acceptedAt",
                  format: "formatDate",
                },
                {
                  component: "text",
                  text: ".",
                },
              ],
            },
            {
              component: "heading",
              id: "protection",
              level: 2,
              text: "Data protection",
              condition: "jsonata:$.item.status = 'accepted'",
            },
            {
              component: "paragraph",
              text: "The Department for Environment, Food and Rural Affairs (Defra) is the data controller for personal data you give to RPA. For information on how we handle personal data see the terms and conditions.",
              condition: "jsonata:$.item.status = 'accepted'",
            },
          ],
        },
      },
      endpoints: [
        {
          code: "calculate-funding",
          method: "POST",
          path: "/grantFundingCalculator",
          service: "GRANT_FUNDING_CALCULATOR",
        },
        {
          code: "calculate-agreement-dates",
          method: "POST",
          path: "/api/v1/wmp/payments/calculate",
          service: "LAND_GRANTS",
        },
      ],
    },
  ],
]);

assertValidAgreementDefinitions(agreementDefinitions);

export const getAgreementDefinition = (agreementCode) =>
  agreementDefinitions.get(agreementCode) ?? {
    code: agreementCode,
    source: "legacy",
  };
