import { describe, expect, it } from "vitest";
import { resolveProcessMapping } from "./resolve-process-mapping.js";

describe("resolveProcessMapping", () => {
  it("resolves a direct reference without changing its value type", async () => {
    const items = [{ code: "WMP1" }];

    const result = await resolveProcessMapping("$.response.items", {
      response: { items },
    });

    expect(result).toEqual(items);
  });

  it("supports the wildcard used by Caseworking collection references", async () => {
    const result = await resolveProcessMapping("$.response.items[*]", {
      response: { items: [{ code: "WMP1" }, { code: "WMP2" }] },
    });

    expect(result).toEqual([{ code: "WMP1" }, { code: "WMP2" }]);
  });

  it("evaluates an explicitly prefixed JSONata expression", async () => {
    const result = await resolveProcessMapping(
      "jsonata:$.pricePence * $.quantity",
      { pricePence: 3500, quantity: 2.5 },
    );

    expect(result).toBe(8750);
  });

  it("leaves an unprefixed expression as a literal string", async () => {
    const result = await resolveProcessMapping("$.pricePence * $.quantity", {
      pricePence: 3500,
      quantity: 2.5,
    });

    expect(result).toBe("$.pricePence * $.quantity");
  });

  it("supports an explicit default in a JSONata expression", async () => {
    const result = await resolveProcessMapping(
      "jsonata:$.application.quantity ?? 0",
      { application: {} },
    );

    expect(result).toBe(0);
  });

  it("resolves references and expressions throughout objects and arrays", async () => {
    const mapping = {
      scheme: "SFI",
      totalAmountPence: "$.response.totalPence",
      values: ["$.response.quantity", "jsonata:$.response.ratePence * 2"],
    };

    const result = await resolveProcessMapping(mapping, {
      response: { quantity: 2.5, ratePence: 3500, totalPence: 8750 },
    });

    expect(result).toEqual({
      scheme: "SFI",
      totalAmountPence: 8750,
      values: [2.5, 7000],
    });
  });

  it("maps a collection using itemsRef, items and the current @ item", async () => {
    const mapping = {
      itemsRef: "$.response.items",
      items: {
        code: "@.type",
        quantity: "@.quantity",
        totalAmountPence: "jsonata:@.ratePence * @.quantity",
        agreementTotalPence: "$.response.totalPence",
      },
    };

    const result = await resolveProcessMapping(mapping, {
      response: {
        totalPence: 7500,
        items: [
          { type: "largeWhite", quantity: 2, ratePence: 1000 },
          { type: "berkshire", quantity: 1, ratePence: 5500 },
        ],
      },
    });

    expect(result).toEqual([
      {
        code: "largeWhite",
        quantity: 2,
        totalAmountPence: 2000,
        agreementTotalPence: 7500,
      },
      {
        code: "berkshire",
        quantity: 1,
        totalAmountPence: 5500,
        agreementTotalPence: 7500,
      },
    ]);
  });

  it("allows itemsRef to filter a collection with JSONata", async () => {
    const mapping = {
      itemsRef: "jsonata:$.response.items[quantity > 0]",
      items: {
        code: "@.type",
        quantity: "@.quantity",
      },
    };

    const result = await resolveProcessMapping(mapping, {
      response: {
        items: [
          { type: "largeWhite", quantity: 2 },
          { type: "berkshire", quantity: 0 },
        ],
      },
    });

    expect(result).toEqual([{ code: "largeWhite", quantity: 2 }]);
  });

  it("returns an empty collection when a JSONata filter matches nothing", async () => {
    const result = await resolveProcessMapping(
      {
        itemsRef: "jsonata:$.response.items[quantity > 0]",
        items: { code: "@.type" },
      },
      { response: { items: [{ type: "berkshire", quantity: 0 }] } },
    );

    expect(result).toEqual([]);
  });

  it("maps nested collections relative to each current item", async () => {
    const mapping = {
      itemsRef: "$.response.groups",
      items: {
        code: "@.code",
        items: {
          itemsRef: "@.items",
          items: {
            code: "@.code",
          },
        },
      },
    };

    const result = await resolveProcessMapping(mapping, {
      response: {
        groups: [
          {
            code: "pigs",
            items: [{ code: "largeWhite" }, { code: "berkshire" }],
          },
        ],
      },
    });

    expect(result).toEqual([
      {
        code: "pigs",
        items: [{ code: "largeWhite" }, { code: "berkshire" }],
      },
    ]);
  });

  it("fails without exposing context data when a mapping cannot be resolved", async () => {
    const context = { agreement: { sbi: "106284736" } };

    await expect(
      resolveProcessMapping("$.agreement.missing", context),
    ).rejects.toThrow(/^Unresolved process mapping "\$\.agreement\.missing"$/);
  });

  it("rejects a collection mapping without an item template", async () => {
    await expect(
      resolveProcessMapping(
        { itemsRef: "$.response.items" },
        {
          response: { items: [] },
        },
      ),
    ).rejects.toThrow(
      'Process collection mapping requires both "itemsRef" and "items"',
    );
  });

  it("rejects fields outside the collection mapping convention", async () => {
    await expect(
      resolveProcessMapping(
        {
          itemsRef: "$.response.items",
          items: { code: "@.code" },
          unexpected: true,
        },
        { response: { items: [] } },
      ),
    ).rejects.toThrow(
      'Process collection mapping only supports "itemsRef" and "items"',
    );
  });

  it("rejects a collection reference that does not resolve to an array", async () => {
    await expect(
      resolveProcessMapping(
        {
          itemsRef: "$.response.item",
          items: { code: "@.code" },
        },
        { response: { item: { code: "WMP1" } } },
      ),
    ).rejects.toThrow(
      'Process collection mapping "$.response.item" must resolve to an array',
    );
  });
});
