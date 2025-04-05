import { it, expect } from "vitest";
import { questions } from "./questions.js";

it("requires 2020-12 dialect", () => {
  const result = questions.validate({
    $schema: "https://json-schema.org/draft-07/schema",
    type: "object",
  });

  expect(result.error.message).toEqual(
    'no schema with key or ref "https://json-schema.org/draft-07/schema"',
  );
});

it("requires questions to at least be an object", () => {
  const result = questions.validate({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "string",
  });

  expect(result.error.message).toEqual('"type" must be [object]');
});

it("allows defining custom answer schemas", () => {
  const result = questions.validate({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer" },
      married: { type: "boolean" },
      birthday: { type: "string", format: "date" },
      hobbies: {
        type: "array",
        items: { type: "string" },
      },
      address: {
        type: "object",
        properties: {
          street: { type: "string" },
          city: { type: "string" },
          zipCode: { type: "string" },
        },
        required: ["street", "city"],
      },
      contact: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
          phone: { type: "string", pattern: "^\\d{10}$" },
        },
        required: ["email"],
      },
    },
    required: ["name"],
    depedentRequired: {
      name: ["age"],
    },
    additionalProperties: false,
    if: {
      properties: {
        married: { const: true },
      },
      then: {
        properties: {
          spouseName: { type: "string" },
        },
        required: ["spouseName"],
      },
    },
  });

  expect(result.error).toEqual(undefined);
});

it("validates schema vocabulary", () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      name: { type: "banana" },
    },
  };

  const result = questions.validate(schema);

  expect(result.error.message).toEqual(
    "'/properties/name/type' must be equal to one of the allowed values array, boolean, integer, null, number, object, string",
  );
});
