const AGREEMENT_NUMBER_REF = "$.agreement.agreementNumber";
const DATE_LONG_FORMAT = "dateLong";
const POUNDS_FROM_PENCE_FORMAT = "poundsFromPence";
const SUMMARY_LIST_COMPONENT = "summary-list";

const PIGS_AND_FUNDING_TABLE = {
  component: "table",
  head: [{ text: "Pig type" }, { text: "Funding amount" }],
  rowsRef: "$.agreement.supplementaryData.fundingCalculation.items",
  rows: [
    { text: "@.description" },
    { text: "@.total", format: POUNDS_FROM_PENCE_FORMAT },
  ],
};

const PAYMENT_SCHEDULE_COMPONENTS = [
  {
    component: SUMMARY_LIST_COMPONENT,
    rows: [
      {
        label: "Agreement start date",
        text: "$.agreement.paymentCalculation.agreementStartDate",
        format: DATE_LONG_FORMAT,
      },
      {
        label: "Agreement end date",
        text: "$.agreement.paymentCalculation.agreementEndDate",
        format: DATE_LONG_FORMAT,
      },
      {
        label: "Total payment",
        text: "$.agreement.paymentCalculation.agreementTotalPence",
        format: POUNDS_FROM_PENCE_FORMAT,
      },
    ],
  },
  {
    component: "table",
    head: [{ text: "Payment date" }, { text: "Amount" }],
    rowsRef: "$.agreement.paymentCalculation.payments",
    rows: [
      { text: "@.dueDate", format: DATE_LONG_FORMAT },
      { text: "@.totalAmountPence", format: POUNDS_FROM_PENCE_FORMAT },
    ],
  },
];

export const pmfAgreementDefinition = {
  code: "pigs-might-fly",
  configVersion: "1.2.0",
  agreementNumberPrefix: "PMF",
  endpoints: [
    {
      code: "calculate-funding",
      method: "POST",
      path: "/grantFundingCalculator",
      service: "GRANT_FUNDING_CALCULATOR",
    },
    {
      code: "calculate-payment-schedule",
      method: "POST",
      path: "/paymentSchedule",
      service: "GRANT_FUNDING_CALCULATOR",
    },
  ],
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
          supplementaryData: {
            fundingCalculation: "$.outputs.fundingCalculation",
          },
        },
      },
      { name: "publish", params: { event: "lifecycle" } },
    ],
  },
  states: {
    offered: {
      page: "offered",
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
              name: "callEndpoint",
              output: "paymentCalculation",
              params: {
                endpoint: {
                  code: "calculate-payment-schedule",
                  endpointParams: {
                    BODY: {
                      agreementStartDate: "$.executedAt",
                      pigTypes: [
                        {
                          pigType: "largeWhite",
                          quantity: "$.agreement.payload.whitePigsCount ?? 0",
                        },
                        {
                          pigType: "britishLandrace",
                          quantity:
                            "$.agreement.payload.britishLandracePigsCount ?? 0",
                        },
                        {
                          pigType: "berkshire",
                          quantity:
                            "$.agreement.payload.berkshirePigsCount ?? 0",
                        },
                        {
                          pigType: "other",
                          quantity: "$.agreement.payload.otherPigsCount ?? 0",
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
                acceptedAt: "$.executedAt",
                paymentCalculation: "$.outputs.paymentCalculation.payment",
              },
            },
            {
              name: "createPayment",
              params: {
                paymentCalculation: "$.outputs.paymentCalculation.payment",
                mapping: {
                  scheme: "SFI",
                  sourceSystem: "FPTT",
                  deliveryBody: "RP00",
                  fesCode: "FALS_FPTT",
                  ledger: "AP",
                  currency: "GBP",
                  invoiceLine: {
                    schemeCode: "CMOR1",
                    accountCode: "SOS710",
                    fundCode: "DRD10",
                  },
                },
              },
            },
            { name: "publish", params: { event: "lifecycle" } },
          ],
        },
      },
    },
    accepted: {
      page: "accepted",
    },
  },
  pages: {
    document: {
      title: "Pigs Might Fly agreement document",
      layout: "document",
      contents: true,
      print: true,
      watermark: {
        condition: "jsonata:$.agreement.state = 'offered'",
        text: "DRAFT",
      },
      components: [
        {
          component: "notification-banner",
          condition: "jsonata:$.agreement.state = 'offered'",
          title: "This is a draft version of your agreement",
        },
        {
          component: "heading",
          level: 1,
          text: "Pigs Might Fly agreement document",
        },
        {
          component: SUMMARY_LIST_COMPONENT,
          rows: [
            { label: "SBI", text: "$.agreement.identifiers.sbi" },
            {
              label: "Agreement number",
              text: AGREEMENT_NUMBER_REF,
            },
          ],
        },
      ],
      sections: [
        {
          id: "agreement-overview",
          title: "Agreement overview",
          components: [
            {
              component: "paragraph",
              text: "This test agreement records the pigs included in your offer, the funding amount and, after acceptance, the payment schedule.",
            },
          ],
        },
        {
          id: "pigs-and-funding",
          title: "Pigs and funding",
          components: [PIGS_AND_FUNDING_TABLE],
        },
        {
          id: "payment-schedule",
          title: "Payment schedule",
          condition: "jsonata:$.agreement.state = 'accepted'",
          components: PAYMENT_SCHEDULE_COMPONENTS,
        },
        {
          id: "acceptance",
          title: "Acceptance",
          condition: "jsonata:$.agreement.state = 'accepted'",
          components: [
            {
              component: SUMMARY_LIST_COMPONENT,
              rows: [
                {
                  label: "Accepted on",
                  text: "$.agreement.acceptedAt",
                  format: DATE_LONG_FORMAT,
                },
              ],
            },
            {
              component: "paragraph",
              text: "This agreement was accepted electronically.",
            },
          ],
        },
        {
          id: "about-this-test-agreement",
          title: "About this test agreement",
          components: [
            {
              component: "paragraph",
              text: "Pigs Might Fly is a test grant used to check the agreement service. It is not a real grant agreement.",
            },
          ],
        },
      ],
    },
    offered: {
      title: "Review your agreement offer",
      components: [
        { component: "heading", level: 1, text: "Review your agreement offer" },
        {
          component: "paragraph",
          text: "Check the details of this test agreement before you continue.",
        },
        {
          component: SUMMARY_LIST_COMPONENT,
          rows: [
            { label: "SBI", text: "$.agreement.identifiers.sbi" },
            { label: "Agreement number", text: AGREEMENT_NUMBER_REF },
          ],
        },
        { component: "heading", level: 2, text: "Pigs and funding" },
        PIGS_AND_FUNDING_TABLE,
        {
          component: "paragraph",
          text: "Your payment schedule and agreement dates will be confirmed when you accept the offer.",
        },
        {
          component: "url",
          href: {
            urlTemplate: "/agreements/{agreementNumber}/document",
            params: { agreementNumber: AGREEMENT_NUMBER_REF },
          },
          text: "View the draft agreement",
          classes: "govuk-link govuk-!-display-block govuk-!-margin-bottom-4",
        },
      ],
      actions: [
        {
          name: "accept",
          method: "GET",
          href: {
            urlTemplate: "/agreements/{agreementNumber}/actions/{name}",
            params: {
              agreementNumber: AGREEMENT_NUMBER_REF,
              name: "accept",
            },
          },
          text: "Continue",
        },
      ],
    },
    accept: {
      title: "Accept your agreement offer",
      components: [
        { component: "heading", level: 1, text: "Accept your agreement offer" },
        {
          component: "paragraph",
          text: "By accepting this offer, you confirm that:",
        },
        {
          component: "unordered-list",
          items: [
            { text: "the information in the agreement is correct" },
            { text: "you have authority to accept the agreement" },
            { text: "you understand this is a test grant" },
          ],
        },
        {
          component: "checkboxes",
          name: "confirm",
          items: [
            {
              value: "confirmed",
              text: "I confirm I have read the information in this section and accept this agreement offer.",
            },
          ],
        },
      ],
      actions: [
        {
          name: "accept",
          method: "POST",
          href: {
            urlTemplate: "/agreements/{agreementNumber}/actions/{name}",
            params: {
              agreementNumber: AGREEMENT_NUMBER_REF,
              name: "accept",
            },
          },
          text: "Accept agreement offer",
        },
      ],
    },
    accepted: {
      title: "Your agreement is now active",
      components: [
        {
          component: "panel",
          title: "Agreement offer accepted",
          text: "Agreement number: $.agreement.agreementNumber",
        },
        {
          component: "heading",
          level: 2,
          text: "Payment schedule",
        },
        ...PAYMENT_SCHEDULE_COMPONENTS,
        {
          component: "url",
          href: {
            urlTemplate: "/agreements/{agreementNumber}/document",
            params: { agreementNumber: AGREEMENT_NUMBER_REF },
          },
          text: "View and print your agreement",
        },
      ],
      actions: [],
    },
  },
};
