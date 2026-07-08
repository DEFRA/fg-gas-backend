import { describe, expect, it } from "vitest";
import { resolveEffectParams } from "./resolve-effect-params.js";

describe("resolveEffectParams", () => {
  it("resolves a $. ref against the context", async () => {
    const result = await resolveEffectParams("$.outputs.fundingCalculation", {
      outputs: { fundingCalculation: { amount: 42 } },
    });

    expect(result).toEqual({ amount: 42 });
  });

  it("uses the ?? default when the referenced value is missing", async () => {
    const result = await resolveEffectParams("$.answers.missing ?? 0", {
      answers: {},
    });

    expect(result).toBe(0);
  });

  it("does not fall back to the default for an explicit null (JSONata's ?? only treats undefined as nullish)", async () => {
    const result = await resolveEffectParams("$.answers.whitePigsCount ?? 0", {
      answers: { whitePigsCount: null },
    });

    expect(result).toBeNull();
  });

  it("uses the referenced value over the default when present", async () => {
    const result = await resolveEffectParams("$.answers.whitePigsCount ?? 0", {
      answers: { whitePigsCount: 5 },
    });

    expect(result).toBe(5);
  });

  it("throws when a ref with no ?? default resolves to undefined", async () => {
    await expect(
      resolveEffectParams("$.outputs.missing", { outputs: {} }),
    ).rejects.toThrow(/Unresolved reference "\$\.outputs\.missing"/);
  });

  it("throws when a nested ref with no ?? default resolves to undefined, catching output/reference drift", async () => {
    await expect(
      resolveEffectParams(
        { fundingCalculation: "$.outputs.fundingCalculation" },
        { outputs: {} },
      ),
    ).rejects.toThrow(/Unresolved reference "\$\.outputs\.fundingCalculation"/);
  });

  it("returns a non-$. string as a literal", async () => {
    const result = await resolveEffectParams("largeWhite", {});

    expect(result).toBe("largeWhite");
  });

  it("returns non-string, non-object values as-is", async () => {
    expect(await resolveEffectParams(42, {})).toBe(42);
    expect(await resolveEffectParams(true, {})).toBe(true);
    expect(await resolveEffectParams(null, {})).toBeNull();
  });

  it("resolves each element of an array", async () => {
    const result = await resolveEffectParams(
      ["$.answers.a", "literal", "$.answers.b ?? 0"],
      { answers: { a: 1 } },
    );

    expect(result).toEqual([1, "literal", 0]);
  });

  it("resolves each value of a plain object, leaving keys untouched", async () => {
    const result = await resolveEffectParams(
      { fundingCalculation: "$.outputs.fundingCalculation" },
      { outputs: { fundingCalculation: { amount: 42 } } },
    );

    expect(result).toEqual({ fundingCalculation: { amount: 42 } });
  });

  it("resolves a nested array of objects, mirroring PMF's pigTypes shape", async () => {
    const result = await resolveEffectParams(
      {
        pigTypes: [
          { pigType: "largeWhite", quantity: "$.answers.whitePigsCount ?? 0" },
          {
            pigType: "britishLandrace",
            quantity: "$.answers.britishLandracePigsCount ?? 0",
          },
        ],
      },
      { answers: { whitePigsCount: 5 } },
    );

    expect(result).toEqual({
      pigTypes: [
        { pigType: "largeWhite", quantity: 5 },
        { pigType: "britishLandrace", quantity: 0 },
      ],
    });
  });
});
