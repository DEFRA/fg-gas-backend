import { describe, expect, it, vi } from "vitest";
import { Grant } from "../models/grant.js";
import { save } from "../repositories/grant.repository.js";
import { createGrantUseCase } from "./create-grant.use-case.js";

vi.mock("../repositories/grant.repository.js");

describe("createGrantUseCase", () => {
  it("creates a grant", async () => {
    const grant = await createGrantUseCase({
      code: "test-grant",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        { name: "action1", method: "POST", url: "http://example.com/action1" },
        { name: "action2", method: "GET", url: "http://example.com/action2" },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    expect(save).toHaveBeenCalledWith(grant);

    expect(grant).toStrictEqual(
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [
          {
            name: "action1",
            method: "POST",
            url: "http://example.com/action1",
          },
          { name: "action2", method: "GET", url: "http://example.com/action2" },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );
  });

  it("creates a grant with externalStatusMap", async () => {
    const grant = await createGrantUseCase({
      code: "test-grant",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        { name: "action1", method: "POST", url: "http://example.com/action1" },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
      externalStatusMap: {
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW",
                statuses: [
                  {
                    code: "IN_PROGRESS",
                    source: "CW",
                    mappedTo: "IN_PROGRESS",
                  },
                  {
                    code: "APPROVED",
                    source: "CW",
                    mappedTo: "APPROVED",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(save).toHaveBeenCalledWith(grant);

    expect(grant).toStrictEqual(
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [
          {
            name: "action1",
            method: "POST",
            url: "http://example.com/action1",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
        externalStatusMap: {
          phases: [
            {
              code: "PRE_AWARD",
              stages: [
                {
                  code: "REVIEW",
                  statuses: [
                    {
                      code: "IN_PROGRESS",
                      source: "CW",
                      mappedTo: "IN_PROGRESS",
                    },
                    {
                      code: "APPROVED",
                      source: "CW",
                      mappedTo: "APPROVED",
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("creates a grant with entitlementTemplates", async () => {
    const phases = [
      {
        code: "PRE_AWARD",
        stages: [
          {
            code: "ASSESSMENT",
            statuses: [{ code: "APPLICATION_RECEIVED", validFrom: [] }],
          },
        ],
      },
    ];
    const entitlementTemplates = [
      {
        code: "ENT_CS_CAPITAL_PA3",
        name: "PA3 entitlement",
        description: "The maximum eligible area that can be claimed.",
        appliesTo: { level: "AGREEMENT", itemCode: null },
        limit: { field: "limitQuantity", unit: "HA" },
        creation: {
          availableAt: ["PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED"],
          onCreated: {
            targetPosition: "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
          },
          inputSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: { limitQuantity: { type: "number" } },
          },
          form: { content: [{ component: "input", field: "limitQuantity" }] },
        },
        claim: {
          availableAt: ["PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED"],
          limits: { maximumClaims: 1, allowsPartialClaims: false },
          onCreated: {
            targetPosition: "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
          },
          payment: {
            calculationAction: "calculate-capital-claim",
            trigger: "ON_CLAIM_CREATED",
          },
        },
      },
    ];

    const grant = await createGrantUseCase({
      code: "test-grant",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [],
      phases,
      entitlementTemplates,
    });

    expect(save).toHaveBeenCalledWith(grant);
    expect(grant.entitlementTemplates).toEqual(entitlementTemplates);
  });
});
