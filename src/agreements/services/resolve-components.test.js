import { describe, expect, it } from "vitest";
import { resolveComponents } from "./resolve-components.js";

describe("resolveComponents", () => {
  it("passes non-table components through, resolving any refs against the context", async () => {
    const components = [
      { component: "heading", level: 1, text: "Review your agreement offer" },
      { component: "paragraph", text: "$.agreement.agreementNumber" },
    ];

    const result = await resolveComponents(components, {
      agreement: { agreementNumber: "PMF823153883" },
    });

    expect(result).toEqual([
      { component: "heading", level: 1, text: "Review your agreement offer" },
      { component: "paragraph", text: "PMF823153883" },
    ]);
  });

  it("resolves string and structured hrefs for url components", async () => {
    const components = [
      {
        component: "url",
        href: "/agreements/$.agreement.agreementNumber/document",
        text: "View using a string href",
      },
      {
        component: "url",
        href: {
          urlTemplate: "/agreements/{agreementNumber}/document",
          params: {
            agreementNumber: "$.agreement.agreementNumber",
          },
        },
        text: "View using a structured href",
      },
    ];

    const result = await resolveComponents(components, {
      agreement: { agreementNumber: "PMF823153883" },
    });

    expect(result).toEqual([
      {
        component: "url",
        href: "/agreements/PMF823153883/document",
        text: "View using a string href",
      },
      {
        component: "url",
        href: "/agreements/PMF823153883/document",
        text: "View using a structured href",
      },
    ]);
  });

  it("resolves a structured href for a url nested inside display components", async () => {
    const components = [
      {
        component: "unordered-list",
        items: [
          {
            component: "paragraph",
            items: [
              { text: "your " },
              {
                component: "url",
                href: {
                  urlTemplate: "/agreements/{agreementNumber}/document",
                  params: {
                    agreementNumber: "$.agreement.agreementNumber",
                  },
                },
                text: "agreement document",
              },
            ],
          },
        ],
      },
    ];

    const result = await resolveComponents(components, {
      agreement: { agreementNumber: "PMF823153883" },
    });

    expect(result).toEqual([
      {
        component: "unordered-list",
        items: [
          {
            component: "paragraph",
            items: [
              { text: "your " },
              {
                component: "url",
                href: "/agreements/PMF823153883/document",
                text: "agreement document",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("applies format outside of a table, on any resolved component", async () => {
    const components = [
      {
        component: "paragraph",
        text: "$.item.total",
        format: "poundsNoDecimals",
      },
    ];

    const result = await resolveComponents(components, {
      item: { total: 320 },
    });

    expect(result).toEqual([{ component: "paragraph", text: "£320" }]);
  });

  it("resolves a table's rowsRef and formats each row against the referenced items", async () => {
    const components = [
      {
        component: "table",
        head: [{ text: "Pig Type" }, { text: "Amount" }],
        rowsRef: "$.snapshot.agreement.actions",
        rows: [
          { text: "$.description" },
          { text: "$.total", format: "poundsNoDecimals" },
        ],
      },
    ];

    const context = {
      snapshot: {
        agreement: {
          actions: [
            { description: "Large White", total: 320 },
            { description: "Berkshire", total: 60.5 },
          ],
        },
      },
    };

    const result = await resolveComponents(components, context);

    expect(result).toEqual([
      {
        component: "table",
        head: [{ text: "Pig Type" }, { text: "Amount" }],
        rows: [
          [{ text: "Large White" }, { text: "£320" }],
          [{ text: "Berkshire" }, { text: "£61" }],
        ],
      },
    ]);
  });

  it("resolves to an empty rows array when rowsRef resolves to an empty array", async () => {
    const components = [
      {
        component: "table",
        rowsRef: "$.items",
        rows: [{ text: "$.description" }],
      },
    ];

    const result = await resolveComponents(components, { items: [] });

    expect(result).toEqual([{ component: "table", rows: [] }]);
  });

  it("propagates the resolver's error when rowsRef is unresolved", async () => {
    const components = [
      {
        component: "table",
        rowsRef: "$.missing",
        rows: [{ text: "$.description" }],
      },
    ];

    await expect(resolveComponents(components, {})).rejects.toThrow(
      /Unresolved reference "\$\.missing"/,
    );
  });

  it("propagates an error for an unsupported format", async () => {
    const components = [
      {
        component: "table",
        rowsRef: "$.items",
        rows: [{ text: "$.total", format: "unknownFormat" }],
      },
    ];

    await expect(
      resolveComponents(components, { items: [{ total: 5 }] }),
    ).rejects.toThrow('Unsupported format "unknownFormat"');
  });

  it("does not route a non-table component through table resolution just because it happens to have a rowsRef-shaped key", async () => {
    const components = [
      { component: "chart", rowsRef: "not-a-ref", rows: [{ text: "literal" }] },
    ];

    const result = await resolveComponents(components, {});

    expect(result).toEqual([
      { component: "chart", rowsRef: "not-a-ref", rows: [{ text: "literal" }] },
    ]);
  });

  it("throws a clear config error for a table component missing rowsRef or rows", async () => {
    await expect(
      resolveComponents([{ component: "table", rows: [] }], {}),
    ).rejects.toThrow(
      'A "table" component must configure both "rowsRef" and "rows"',
    );

    await expect(
      resolveComponents([{ component: "table", rowsRef: "$.items" }], {}),
    ).rejects.toThrow(
      'A "table" component must configure both "rowsRef" and "rows"',
    );
  });

  it("resolves a table's rows against the item using @. as well as $.", async () => {
    const components = [
      {
        component: "table",
        rowsRef: "$.agreement.actions",
        rows: [
          { text: "@.description" },
          { text: "@.annualAmountPence", format: "poundsNoDecimals" },
        ],
      },
    ];

    const result = await resolveComponents(components, {
      agreement: {
        actions: [{ description: "Hedgerow", annualAmountPence: 125000 }],
      },
    });

    expect(result).toEqual([
      {
        component: "table",
        rows: [[{ text: "Hedgerow" }, { text: "£125,000" }]],
      },
    ]);
  });
});

describe("resolveComponents display conditions", () => {
  const banner = {
    component: "notification-banner",
    condition: "jsonata:$.agreement.state = 'offered'",
    title: "Draft agreement",
    text: "This is a draft version of your agreement.",
  };

  it("includes a component whose condition is true, without the condition itself", async () => {
    const result = await resolveComponents([banner], {
      agreement: { state: "offered" },
    });

    expect(result).toEqual([
      {
        component: "notification-banner",
        title: "Draft agreement",
        text: "This is a draft version of your agreement.",
      },
    ]);
  });

  it("leaves out a component whose condition is false, keeping the order of the rest", async () => {
    const components = [
      { component: "heading", level: 1, text: "Your agreement" },
      banner,
      { component: "paragraph", text: "Accepted" },
    ];

    const result = await resolveComponents(components, {
      agreement: { state: "accepted" },
    });

    expect(result).toEqual([
      { component: "heading", level: 1, text: "Your agreement" },
      { component: "paragraph", text: "Accepted" },
    ]);
  });
});

describe("resolveComponents conditional components", () => {
  const conditional = {
    component: "conditional",
    condition: "jsonata:$.agreement.state = 'accepted'",
    whenTrue: {
      component: "status",
      text: "Accepted",
      classes: "govuk-tag--green",
    },
    whenFalse: {
      component: "status",
      text: "Draft",
      classes: "govuk-tag--blue",
    },
  };

  it.each([
    ["accepted", "Accepted", "govuk-tag--green"],
    ["offered", "Draft", "govuk-tag--blue"],
  ])("selects the %s branch", async (state, text, classes) => {
    const result = await resolveComponents([conditional], {
      agreement: { state },
    });

    expect(result).toEqual([{ component: "status", text, classes }]);
  });

  it("leaves out the component entirely when the selected branch is not configured", async () => {
    const components = [
      { component: "heading", level: 1, text: "Your agreement" },
      {
        component: "conditional",
        condition: "jsonata:$.agreement.state = 'accepted'",
        whenTrue: { component: "status", text: "Accepted" },
      },
      { component: "paragraph", text: "Offered" },
    ];

    const result = await resolveComponents(components, {
      agreement: { state: "offered" },
    });

    expect(result).toEqual([
      { component: "heading", level: 1, text: "Your agreement" },
      { component: "paragraph", text: "Offered" },
    ]);
  });
});

describe("resolveComponents repeated content", () => {
  const parcels = {
    component: "repeat",
    itemsRef: "$.agreement.parcels",
    beforeContent: [{ component: "heading", level: 2, text: "Land parcels" }],
    items: [
      { component: "heading", level: 3, text: "Parcel @.sheetId @.parcelId" },
      { component: "paragraph", text: "Area: @.area.quantity hectares" },
    ],
    emptyContent: [
      { component: "paragraph", text: "No land parcels are recorded." },
    ],
  };

  const withParcels = (list) => ({
    agreement: { parcels: list },
  });

  it("resolves the configured content once per item, in source order", async () => {
    const result = await resolveComponents(
      [parcels],
      withParcels([
        { sheetId: "SX0679", parcelId: "9238", area: { quantity: 1.25 } },
        { sheetId: "SX0680", parcelId: "1104", area: { quantity: 0.5 } },
      ]),
    );

    expect(result).toEqual([
      { component: "heading", level: 2, text: "Land parcels" },
      { component: "heading", level: 3, text: "Parcel SX0679 9238" },
      { component: "paragraph", text: "Area: 1.25 hectares" },
      { component: "heading", level: 3, text: "Parcel SX0680 1104" },
      { component: "paragraph", text: "Area: 0.5 hectares" },
    ]);
  });

  it("uses the empty content, and not the introduction, for an empty array", async () => {
    const result = await resolveComponents([parcels], withParcels([]));

    expect(result).toEqual([
      { component: "paragraph", text: "No land parcels are recorded." },
    ]);
  });

  it("resolves to nothing for an empty array with no empty content configured", async () => {
    const { emptyContent, ...withoutEmptyContent } = parcels;

    const result = await resolveComponents(
      [withoutEmptyContent, { component: "paragraph", text: "After" }],
      withParcels([]),
    );

    expect(result).toEqual([{ component: "paragraph", text: "After" }]);
  });

  it("reaches agreement-level data from inside repeated content", async () => {
    const components = [
      {
        component: "repeat",
        itemsRef: "$.agreement.parcels",
        items: [
          { component: "paragraph", text: "@.sheetId on $.agreement.sbi" },
        ],
      },
    ];

    const result = await resolveComponents(components, {
      agreement: { sbi: "106284736", parcels: [{ sheetId: "SX0679" }] },
    });

    expect(result).toEqual([
      { component: "paragraph", text: "SX0679 on 106284736" },
    ]);
  });

  it("applies formatting inside repeated content", async () => {
    const components = [
      {
        component: "repeat",
        itemsRef: "$.agreement.actions",
        items: [
          {
            component: "paragraph",
            text: "@.annualPaymentPence",
            format: "poundsNoDecimals",
          },
        ],
      },
    ];

    const result = await resolveComponents(components, {
      agreement: { actions: [{ annualPaymentPence: 125000 }] },
    });

    expect(result).toEqual([{ component: "paragraph", text: "£125,000" }]);
  });

  it("fails when the items reference is missing rather than silently showing nothing", async () => {
    await expect(
      resolveComponents([parcels], { agreement: {} }),
    ).rejects.toThrow('Unresolved reference "$.agreement.parcels"');
  });

  it("fails when the items reference does not resolve to an array", async () => {
    await expect(
      resolveComponents([parcels], withParcels({ sheetId: "SX0679" })),
    ).rejects.toThrow(
      'A "repeat" component\'s "itemsRef" ("$.agreement.parcels") must resolve to an array',
    );
  });

  it("honours a condition on the repeat itself", async () => {
    const result = await resolveComponents(
      [{ ...parcels, condition: "jsonata:$.agreement.state = 'accepted'" }],
      {
        ...withParcels([{ sheetId: "SX0679", parcelId: "9238" }]),
        agreement: {
          state: "offered",
          parcels: [{ sheetId: "SX0679" }],
        },
      },
    );

    expect(result).toEqual([]);
  });
});

describe("resolveComponents explicit component trees", () => {
  it("preserves structural nodes while resolving nested components with table-row scope", async () => {
    const components = [
      {
        component: "grid-row",
        components: [
          {
            component: "grid-column",
            width: "full",
            components: [
              {
                component: "form",
                action: "accept",
                components: [
                  {
                    component: "table",
                    rowsRef: "$.agreement.actions",
                    rows: [{ text: "@.description" }],
                  },
                  {
                    component: "conditional",
                    condition: "jsonata:$.agreement.state = 'offered'",
                    whenTrue: {
                      component: "paragraph",
                      text: "Offer available",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const result = await resolveComponents(components, {
      agreement: {
        state: "offered",
        actions: [{ description: "Hedgerow" }],
      },
    });

    expect(result).toEqual([
      {
        component: "grid-row",
        components: [
          {
            component: "grid-column",
            width: "full",
            components: [
              {
                component: "form",
                action: "accept",
                components: [
                  {
                    component: "table",
                    rows: [[{ text: "Hedgerow" }]],
                  },
                  { component: "paragraph", text: "Offer available" },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe("resolveComponents containers and templates", () => {
  it("flattens a container's content into its parent", async () => {
    const components = [
      {
        component: "component-container",
        content: [
          { component: "heading", level: 2, text: "Payments" },
          { component: "paragraph", text: "$.agreement.summary" },
        ],
      },
    ];

    const result = await resolveComponents(components, {
      agreement: { summary: "Annual" },
    });

    expect(result).toEqual([
      { component: "heading", level: 2, text: "Payments" },
      { component: "paragraph", text: "Annual" },
    ]);
  });

  it("hides a whole group of content with one condition on the container", async () => {
    const components = [
      {
        component: "component-container",
        condition: "jsonata:$.agreement.state = 'accepted'",
        content: [
          { component: "heading", level: 2, text: "Payments" },
          { component: "paragraph", text: "Annual" },
        ],
      },
      { component: "paragraph", text: "After" },
    ];

    const result = await resolveComponents(components, {
      agreement: { state: "offered" },
    });

    expect(result).toEqual([{ component: "paragraph", text: "After" }]);
  });

  it("supports containers nested inside containers", async () => {
    const components = [
      {
        component: "component-container",
        content: [
          {
            component: "component-container",
            content: [{ component: "paragraph", text: "$.agreement.summary" }],
          },
        ],
      },
    ];

    const result = await resolveComponents(components, {
      agreement: { summary: "Annual" },
    });

    expect(result).toEqual([{ component: "paragraph", text: "Annual" }]);
  });

  const templates = {
    paymentSummary: {
      annual: {
        content: [
          { component: "heading", level: 2, text: "Annual payment" },
          {
            component: "paragraph",
            text: "@.annualPaymentPence",
            format: "poundsNoDecimals",
          },
        ],
      },
      quarterly: {
        content: [
          { component: "heading", level: 2, text: "Quarterly payment" },
        ],
      },
    },
  };

  const templateComponent = {
    component: "template",
    templateRef: "$.definition.templates.paymentSummary",
    templateKey: "$.agreement.paymentScheme",
    dataRef: "$.agreement.paymentSummary",
  };

  it("resolves the template selected by agreement data, against the data it configures", async () => {
    const result = await resolveComponents([templateComponent], {
      definition: { templates },
      agreement: {
        paymentScheme: "annual",
        paymentSummary: { annualPaymentPence: 125000 },
      },
    });

    expect(result).toEqual([
      { component: "heading", level: 2, text: "Annual payment" },
      { component: "paragraph", text: "£125,000" },
    ]);
  });

  it("selects a different template for a different agreement", async () => {
    const result = await resolveComponents([templateComponent], {
      definition: { templates },
      agreement: { paymentScheme: "quarterly", paymentSummary: {} },
    });

    expect(result).toEqual([
      { component: "heading", level: 2, text: "Quarterly payment" },
    ]);
  });

  it("uses the repeated item as the template's data when no dataRef is configured", async () => {
    const components = [
      {
        component: "repeat",
        itemsRef: "$.agreement.payments",
        items: [
          {
            component: "template",
            templateRef: "$.definition.templates.paymentSummary",
            templateKey: "@.scheme",
          },
        ],
      },
    ];

    const result = await resolveComponents(components, {
      definition: { templates },
      agreement: {
        payments: [{ scheme: "annual", annualPaymentPence: 60000 }],
      },
    });

    expect(result).toEqual([
      { component: "heading", level: 2, text: "Annual payment" },
      { component: "paragraph", text: "£60,000" },
    ]);
  });

  // The key comes from Agreement data, so an inherited property name must not
  // be mistaken for a configured template.
  it.each(["constructor", "__proto__", "toString"])(
    "fails clearly when agreement data selects the inherited property %s",
    async (paymentScheme) => {
      await expect(
        resolveComponents([templateComponent], {
          definition: { templates },
          agreement: { paymentScheme, paymentSummary: {} },
        }),
      ).rejects.toThrow(/has no template/);
    },
  );

  it("resolves a conditional branch holding several components", async () => {
    const components = [
      {
        component: "conditional",
        condition: "jsonata:$.agreement.state = 'accepted'",
        whenTrue: [
          { component: "heading", level: 2, text: "Accepted" },
          { component: "paragraph", text: "$.agreement.acceptedAt" },
        ],
      },
    ];

    const result = await resolveComponents(components, {
      agreement: { state: "accepted", acceptedAt: "2026-07-27" },
    });

    expect(result).toEqual([
      { component: "heading", level: 2, text: "Accepted" },
      { component: "paragraph", text: "2026-07-27" },
    ]);
  });

  it("fails when the selected template does not exist", async () => {
    await expect(
      resolveComponents([templateComponent], {
        definition: { templates },
        agreement: { paymentScheme: "monthly", paymentSummary: {} },
      }),
    ).rejects.toThrow(
      'A "template" component references "$.definition.templates.paymentSummary" which has no template "monthly"',
    );
  });
});
