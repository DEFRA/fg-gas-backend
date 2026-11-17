import { describe, expect, it } from "vitest";
import { questionPaths } from "./question-paths.js";

describe("questionPaths", () => {
  it("names every leaf, through arrays, local refs and branches", () => {
    const questions = {
      type: "object",
      properties: {
        applicant: {
          type: "object",
          properties: {
            business: {
              type: "object",
              properties: {
                name: { type: "string" },
                address: { $ref: "#/$defs/address" },
              },
            },
          },
        },
        landParcels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              parcelId: { type: "string" },
              areaHa: { type: ["number", "null"] },
            },
          },
        },
        tags: { type: "array", items: { type: "string" } },
        agreed: { const: true },
        declared: { type: "boolean" },
      },
      if: { properties: { agreed: { const: true } } },
      then: {
        properties: { signedAt: { type: "string", format: "date-time" } },
      },
      $defs: {
        address: {
          type: "object",
          properties: { postalCode: { type: "string" } },
        },
      },
    };

    expect(questionPaths(questions)).toEqual([
      { path: "answers.applicant.business.name", type: "text" },
      { path: "answers.applicant.business.address.postalCode", type: "text" },
      { path: "answers.landParcels[*].parcelId", type: "text" },
      { path: "answers.landParcels[*].areaHa", type: "number" },
      { path: "answers.tags[*]", type: "text" },
      { path: "answers.agreed", type: null },
      { path: "answers.declared", type: "boolean" },
      { path: "answers.signedAt", type: "date" },
    ]);
  });

  it("ends on a ref that nests itself", () => {
    const questions = {
      properties: { node: { $ref: "#/$defs/node" } },
      $defs: {
        node: {
          type: "object",
          properties: {
            id: { type: "string" },
            next: { $ref: "#/$defs/node" },
          },
        },
      },
    };

    expect(questionPaths(questions)).toContainEqual({
      path: "answers.node.id",
      type: "text",
    });
    expect(questionPaths(questions).length).toBeLessThan(20);
  });

  it("names nothing for a schema that is not one", () => {
    expect(questionPaths(null)).toEqual([]);
    expect(questionPaths(true)).toEqual([]);
  });
});
