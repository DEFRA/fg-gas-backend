import { describe, expect, it } from "vitest";
import { validateAnswersAgainstSchema } from "./schema-validation.service.js";

const baseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    field1: { type: "number" },
    field2: { type: "number" },
    total: { type: "number" },
  },
};

describe("validateAnswersAgainstSchema", () => {
  describe("fgSumEquals", () => {
    const schema = {
      ...baseSchema,
      fgSumEquals: {
        fields: ["field1", "field2"],
        targetField: "total",
      },
    };

    it("passes when sum of fields equals the target field", () => {
      const result = validateAnswersAgainstSchema("ref-1", schema, {
        field1: 10,
        field2: 20,
        total: 30,
      });

      expect(result).toEqual({ field1: 10, field2: 20, total: 30 });
    });

    it("throws when sum of fields does not equal the target field", () => {
      expect(() =>
        validateAnswersAgainstSchema("ref-1", schema, {
          field1: 10,
          field2: 20,
          total: 50,
        }),
      ).toThrow(
        'Application with clientRef "ref-1" has invalid answers: data fgSumEquals validation failed: sum of fields field1, field2 must equal total',
      );
    });

    it("tolerates floating-point rounding at magnitude ~200", () => {
      // 25.3874 + 169.8586 stores as 195.24599999999998 in IEEE 754
      const result = validateAnswersAgainstSchema("ref-1", schema, {
        field1: 25.3874,
        field2: 169.8586,
        total: 195.246,
      });

      expect(result).toMatchObject({ total: 195.246 });
    });
  });

  describe("fgSumEquals with array path syntax", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { area: { type: "number" } },
          },
        },
        total: { type: "number" },
      },
      fgSumEquals: {
        fields: ["items[].area"],
        targetField: "total",
      },
    };

    it("passes when sum of array item field equals the target", () => {
      const result = validateAnswersAgainstSchema("ref-1", schema, {
        items: [{ area: 10 }, { area: 20.5 }],
        total: 30.5,
      });

      expect(result).toEqual({
        items: [{ area: 10 }, { area: 20.5 }],
        total: 30.5,
      });
    });

    it("throws when sum of array item field does not equal the target", () => {
      expect(() =>
        validateAnswersAgainstSchema("ref-1", schema, {
          items: [{ area: 10 }, { area: 20 }],
          total: 50,
        }),
      ).toThrow(
        'Application with clientRef "ref-1" has invalid answers: data fgSumEquals validation failed: sum of fields items[].area must equal total',
      );
    });

    it("treats a missing array as empty (sum 0)", () => {
      expect(() =>
        validateAnswersAgainstSchema("ref-1", schema, { total: 10 }),
      ).toThrow(
        'Application with clientRef "ref-1" has invalid answers: data fgSumEquals validation failed',
      );
    });
  });

  describe("fgSumMin", () => {
    const schema = {
      ...baseSchema,
      fgSumMin: {
        fields: ["field1", "field2"],
        minimum: 0.5,
      },
    };

    it("passes when sum of fields equals the minimum", () => {
      const result = validateAnswersAgainstSchema("ref-1", schema, {
        field1: 0.3,
        field2: 0.2,
      });

      expect(result).toMatchObject({ field1: 0.3, field2: 0.2 });
    });

    it("passes when sum of fields exceeds the minimum", () => {
      const result = validateAnswersAgainstSchema("ref-1", schema, {
        field1: 1,
        field2: 2,
      });

      expect(result).toMatchObject({ field1: 1, field2: 2 });
    });

    it("throws when sum of fields is below the minimum", () => {
      expect(() =>
        validateAnswersAgainstSchema("ref-1", schema, {
          field1: 0.1,
          field2: 0.1,
        }),
      ).toThrow(
        'Application with clientRef "ref-1" has invalid answers: data fgSumMin validation failed: sum of fields field1, field2 must be greater than or equal to 0.5',
      );
    });
  });

  describe("fgSumMax", () => {
    const schema = {
      ...baseSchema,
      fgSumMax: {
        fields: ["field1", "field2"],
        targetField: "total",
      },
    };

    it("passes when sum of fields does not exceed the target field", () => {
      const result = validateAnswersAgainstSchema("ref-1", schema, {
        field1: 10,
        field2: 20,
        total: 50,
      });

      expect(result).toEqual({ field1: 10, field2: 20, total: 50 });
    });

    it("passes when sum of fields equals the target field exactly", () => {
      const result = validateAnswersAgainstSchema("ref-1", schema, {
        field1: 10,
        field2: 20,
        total: 30,
      });

      expect(result).toEqual({ field1: 10, field2: 20, total: 30 });
    });

    it("throws when sum of fields exceeds the target field", () => {
      expect(() =>
        validateAnswersAgainstSchema("ref-1", schema, {
          field1: 30,
          field2: 25,
          total: 50,
        }),
      ).toThrow(
        'Application with clientRef "ref-1" has invalid answers: data fgSumMax validation failed: sum of fields field1, field2 must be less than or equal to total',
      );
    });

    it("tolerates floating-point rounding at the boundary", () => {
      // 8.5 + 4.2 stores as 12.700000000000001 in IEEE 754; must still pass when total = 12.7
      const result = validateAnswersAgainstSchema("ref-1", schema, {
        field1: 8.5,
        field2: 4.2,
        total: 12.7,
      });

      expect(result).toMatchObject({ total: 12.7 });
    });
  });

  describe("standard schema validation", () => {
    it("strips additional properties not in the schema", () => {
      const schema = {
        ...baseSchema,
        additionalProperties: false,
        properties: {
          name: { type: "string" },
        },
      };

      const result = validateAnswersAgainstSchema("ref-1", schema, {
        name: "test",
        extraField: "should be removed",
      });

      expect(result).toEqual({ name: "test" });
    });

    it("throws when required fields are missing", () => {
      const schema = {
        ...baseSchema,
        required: ["field1", "field2"],
      };

      expect(() =>
        validateAnswersAgainstSchema("ref-1", schema, { field1: 10 }),
      ).toThrow('Application with clientRef "ref-1" has invalid answers');
    });
  });

  describe("conditional schema (if/then/else)", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        hasItems: { type: "boolean" },
        items: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
        },
      },
      required: ["hasItems"],
      if: {
        properties: { hasItems: { const: true } },
      },
      then: {
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
        },
      },
      else: {
        properties: { items: false },
      },
    };

    it("passes when condition is true and required field is provided", () => {
      const result = validateAnswersAgainstSchema("ref-1", schema, {
        hasItems: true,
        items: ["item-1"],
      });

      expect(result).toEqual({ hasItems: true, items: ["item-1"] });
    });

    it("throws when condition is true but required field is missing", () => {
      expect(() =>
        validateAnswersAgainstSchema("ref-1", schema, {
          hasItems: true,
        }),
      ).toThrow('Application with clientRef "ref-1" has invalid answers');
    });

    it("throws when condition is false but forbidden field is provided", () => {
      expect(() =>
        validateAnswersAgainstSchema("ref-1", schema, {
          hasItems: false,
          items: ["item-1"],
        }),
      ).toThrow('Application with clientRef "ref-1" has invalid answers');
    });
  });

  describe("error handling", () => {
    it("throws when schema cannot be compiled", () => {
      const invalidSchema = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "invalid-type",
      };

      expect(() =>
        validateAnswersAgainstSchema("ref-1", invalidSchema, {}),
      ).toThrow('Application with clientRef "ref-1" cannot be validated');
    });
  });
});
