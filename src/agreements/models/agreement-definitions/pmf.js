export const pmfAgreementDefinition = {
  code: "pigs-might-fly",
  configVersion: "1.1.0",
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
    offered: {
      title: "Review your agreement offer",
      components: [
        { component: "heading", level: 1, text: "Review your agreement offer" },
        {
          component: "paragraph",
          text: "If you accept this agreement offer, the resulting agreement will be between Defra and:",
        },
        { component: "heading", level: 2, text: "Payments" },
        {
          component: "table",
          head: [{ text: "Pig Type" }, { text: "Amount" }],
          rowsRef: "$.agreement.supplementaryData.fundingCalculation.items",
          rows: [
            { text: "$.description" },
            { text: "$.total", format: "poundsNoDecimals" },
          ],
        },
      ],
      actions: [
        {
          name: "accept",
          method: "GET",
          href: {
            urlTemplate: "/agreements/{agreementNumber}/actions/{name}",
            params: {
              agreementNumber: "$.agreement.agreementNumber",
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
              agreementNumber: "$.agreement.agreementNumber",
              name: "accept",
            },
          },
          text: "Accept agreement offer",
        },
      ],
    },
    // TODO: placeholder copy - real content covered by a follow-up ticket
    accepted: {
      title: "Your agreement is now active",
      components: [
        {
          component: "heading",
          level: 1,
          text: "Your agreement is now active",
        },
      ],
      actions: [],
    },
  },
};
