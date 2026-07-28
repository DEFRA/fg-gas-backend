import { describe, expect, it } from "vitest";
import { resolveCondition, resolveRefs } from "./resolve-refs.js";

const scope = (context, row) => ({ context, row });

describe("resolveRefs", () => {
  it("resolves a whole-string reference to the referenced value, keeping its type", async () => {
    const result = await resolveRefs(
      "$.agreement.parcels",
      scope({ agreement: { parcels: [{ sheetId: "SX0679" }] } }),
    );

    expect(result).toEqual([{ sheetId: "SX0679" }]);
  });

  it("resolves references embedded in surrounding text", async () => {
    const result = await resolveRefs(
      "Parcel @.sheetId @.parcelId",
      scope({}, { sheetId: "SX0679", parcelId: "9238" }),
    );

    expect(result).toBe("Parcel SX0679 9238");
  });

  it("keeps sentence punctuation that follows a reference", async () => {
    const result = await resolveRefs(
      "Your agreement number is $.agreement.agreementNumber.",
      scope({ agreement: { agreementNumber: "PMF823153883" } }),
    );

    expect(result).toBe("Your agreement number is PMF823153883.");
  });

  it("resolves the agreement and the current item in the same string", async () => {
    const result = await resolveRefs(
      "$.agreement.state: @.area.quantity hectares",
      scope({ agreement: { state: "offered" } }, { area: { quantity: 1.25 } }),
    );

    expect(result).toBe("offered: 1.25 hectares");
  });

  it("evaluates a jsonata: expression", async () => {
    const result = await resolveRefs(
      "jsonata:$.agreement.state = 'offered'",
      scope({ agreement: { state: "offered" } }),
    );

    expect(result).toBe(true);
  });

  it("resolves references throughout nested objects and arrays", async () => {
    const result = await resolveRefs(
      { title: "$.a", items: [{ text: "@.b" }, "literal"] },
      scope({ a: "Title" }, { b: "Row" }),
    );

    expect(result).toEqual({
      title: "Title",
      items: [{ text: "Row" }, "literal"],
    });
  });

  it("leaves strings with no references untouched", async () => {
    const result = await resolveRefs("Land parcels", scope({}));

    expect(result).toBe("Land parcels");
  });

  it("throws naming the reference when it cannot be resolved", async () => {
    await expect(resolveRefs("$.agreement.missing", scope({}))).rejects.toThrow(
      'Unresolved reference "$.agreement.missing"',
    );
  });

  it("throws when a reference embedded in text cannot be resolved", async () => {
    await expect(
      resolveRefs("Parcel @.missing here", scope({}, { sheetId: "SX0679" })),
    ).rejects.toThrow('Unresolved reference "@.missing"');
  });

  it("does not leak the resolved agreement data in the error", async () => {
    const context = { agreement: { sbi: "106284736" } };

    await expect(
      resolveRefs("$.agreement.missing", scope(context)),
    ).rejects.toThrow(/^Unresolved reference "\$\.agreement\.missing"$/);
  });

  it("uses a ?? fallback instead of throwing, so a definition can say a value is optional", async () => {
    const result = await resolveRefs("$.agreement.missing ?? 0", scope({}));

    expect(result).toBe(0);
  });

  it("interpolates prose that happens to contain ??, rather than treating it as a fallback", async () => {
    const result = await resolveRefs(
      "Is it @.name??",
      scope({}, { name: "Bob" }),
    );

    expect(result).toBe("Is it Bob??");
  });

  it("fails when a reference used in text resolves to an object", async () => {
    await expect(
      resolveRefs("Area: @.area", scope({}, { area: { quantity: 1.25 } })),
    ).rejects.toThrow(
      'Reference "@.area" resolves to an object and cannot be used in text',
    );
  });

  it("fails when a reference used in text resolves to a list of objects", async () => {
    await expect(
      resolveRefs("Parcels: $.parcels", scope({ parcels: [{ id: 1 }] })),
    ).rejects.toThrow(
      'Reference "$.parcels" resolves to an object and cannot be used in text',
    );
  });

  it("joins a list of values used in text", async () => {
    const result = await resolveRefs(
      "Codes: $.codes",
      scope({ codes: ["A1", "B2"] }),
    );

    expect(result).toBe("Codes: A1 B2");
  });

  it("still resolves an object reference when it is the whole string, since it is a value not text", async () => {
    const result = await resolveRefs(
      "@.area",
      scope({}, { area: { q: 1.25 } }),
    );

    expect(result).toEqual({ q: 1.25 });
  });

  it("leaves a @. inside a jsonata: string literal alone", async () => {
    const result = await resolveRefs("jsonata:'a@.b'", scope({}, { b: "X" }));

    expect(result).toBe("a@.b");
  });

  it("still resolves a row reference at the start of a jsonata: expression", async () => {
    const result = await resolveRefs(
      "jsonata:@.quantity > 1",
      scope({}, { quantity: 2 }),
    );

    expect(result).toBe(true);
  });
});

describe("resolveCondition", () => {
  it.each([
    ["jsonata:$.agreement.state = 'offered'", { state: "offered" }, true],
    ["jsonata:$.agreement.state = 'offered'", { state: "accepted" }, false],
  ])("evaluates %s to %s", async (condition, agreement, expected) => {
    expect(await resolveCondition(condition, scope({ agreement }))).toBe(
      expected,
    );
  });

  it("evaluates a condition against the current item", async () => {
    const result = await resolveCondition(
      "jsonata:@.area.quantity > 1",
      scope({}, { area: { quantity: 1.25 } }),
    );

    expect(result).toBe(true);
  });

  // A condition is how a definition says content may be absent, so unlike a
  // value reference it treats missing data as false rather than failing.
  it("is false for a reference to missing data", async () => {
    expect(await resolveCondition("$.agreement.missing", scope({}))).toBe(
      false,
    );
  });

  it("is false for an empty array", async () => {
    expect(await resolveCondition("$.parcels", scope({ parcels: [] }))).toBe(
      false,
    );
  });

  it("is true for a non-empty array", async () => {
    expect(
      await resolveCondition("$.parcels", scope({ parcels: [{ id: 1 }] })),
    ).toBe(true);
  });
});
