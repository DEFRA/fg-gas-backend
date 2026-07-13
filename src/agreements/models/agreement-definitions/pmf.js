export const pmfAgreementDefinition = {
  code: "pigs-might-fly",
  configVersion: "0.0.1",
  agreementNumberPrefix: "PMF",
  endpoints: [
    {
      code: "calculate-funding",
      method: "POST",
      path: "/grantFundingCalculator",
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
          fundingCalculation: "$.outputs.fundingCalculation",
        },
      },
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
            { name: "createPaymentClaim", output: "paymentClaim" },
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
          rowsRef: "$.item.supplementaryData.fundingCalculation.items",
          rows: [
            { text: "$.description" },
            { text: "$.total", format: "poundsNoDecimals" },
          ],
        },
      ],
      actions: [
        {
          href: {
            urlTemplate: "/{agreementNumber}/accept",
            params: { agreementNumber: "$.agreement.agreementNumber" },
          },
          text: "Continue",
        },
      ],
    },
    accept: {
      title: "Accept your agreement offer",
      components: [
        { component: "heading", level: 1, text: "Accept your agreement offer" },
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
