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
        rowsRef:
          "$.snapshot.items[0].supplementaryData.fundingCalculation.items",
        rows: [
          { text: "$.description" },
          { text: "$.total", format: "poundsNoDecimals" },
        ],
      },
    ];

    const context = {
      snapshot: {
        items: [
          {
            supplementaryData: {
              fundingCalculation: {
                items: [
                  { description: "Large White", total: 320 },
                  { description: "Berkshire", total: 60.5 },
                ],
              },
            },
          },
        ],
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
});
