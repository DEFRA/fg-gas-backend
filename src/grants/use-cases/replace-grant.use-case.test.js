import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import { Grant } from "../models/grant.js";
import { findByCode, replace } from "../repositories/grant.repository.js";
import {
  replaceGrantAuditBuilder,
  replaceGrantUseCase,
} from "./replace-grant.use-case.js";

vi.mock("../repositories/grant.repository.js");
vi.mock("../../common/write-audit-event.js");

describe("replaceGrantUseCase", () => {
  it("carries entitlementTemplates and amendablePositions through the replacement", async () => {
    writeAuditEvent.mockResolvedValue(true);
    findByCode.mockResolvedValue(
      new Grant({
        code: "test-grant",
        version: "0.0.0",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
      }),
    );

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

    await replaceGrantUseCase({
      code: "test-grant",
      command: {
        code: "test-grant",
        metadata: {
          description: "Updated Test Grant Description",
          startDate: "2023-01-02T00:00:00Z",
        },
        actions: [],
        phases,
        amendablePositions: ["PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED"],
        entitlementTemplates,
      },
    });

    const [replacedGrant] = replace.mock.calls.at(-1);

    expect(replacedGrant.entitlementTemplates).toEqual(entitlementTemplates);
    expect(replacedGrant.amendablePositions).toEqual([
      "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
    ]);
  });

  it("replaces the whole grant and creates an audit event", async () => {
    writeAuditEvent.mockResolvedValue(true);
    findByCode.mockResolvedValue(
      new Grant({
        code: "test-grant",
        version: "0.0.0",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    const replacementGrantCommand = {
      code: "test-grant",
      metadata: {
        description: "Updated Test Grant Description",
        startDate: "2023-01-02T00:00:00Z",
      },
      actions: [
        {
          method: "GET",
          name: "get-test",
          url: "http://localhost:3002/test-grant/get-test",
        },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    };

    await replaceGrantUseCase({
      code: "test-grant",
      command: replacementGrantCommand,
    });

    expect(replace).toHaveBeenCalledWith(
      new Grant({
        code: "test-grant",
        version: "0.0.0",
        metadata: {
          description: "Updated Test Grant Description",
          startDate: "2023-01-02T00:00:00Z",
        },
        actions: [
          {
            method: "GET",
            name: "get-test",
            url: "http://localhost:3002/test-grant/get-test",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    expect(writeAuditEvent.mock.calls[0][1]).toBeUndefined();
    expect(writeAuditEvent.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        details: {
          newGrantCommand: {
            actions: [
              {
                method: "GET",
                name: "get-test",
                url: "http://localhost:3002/test-grant/get-test",
              },
            ],
            code: "test-grant",
            metadata: {
              description: "Updated Test Grant Description",
              startDate: "2023-01-02T00:00:00Z",
            },
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
            },
          },
        },
        entities: [
          {
            action: "REPLACE_GRANT",
            entity: "GRANT",
            entityid: "test-grant",
          },
        ],
        segregationRef: "replace-grant-test-grant",
        security: undefined,
        status: "SUCCESS",
      }),
    );
  });

  it("throws notFound when grant does not exist at target version", async () => {
    findByCode.mockResolvedValue(null);

    await expect(
      replaceGrantUseCase({
        code: "test-grant",
        command: {
          version: "2.0.0",
          metadata: {
            description: "Test",
            startDate: "2023-01-01T00:00:00Z",
          },
          actions: [],
        },
      }),
    ).rejects.toThrow(
      Boom.notFound('Grant with code "test-grant" version "2.0.0" not found'),
    );

    expect(findByCode).toHaveBeenCalledWith("test-grant", "2.0.0");
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces the grant with externalStatusMap", async () => {
    findByCode.mockResolvedValue(
      new Grant({
        code: "test-grant",
        version: "0.0.0",
        metadata: {
          description: "Test Grant Description",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    await replaceGrantUseCase({
      code: "test-grant",
      command: {
        code: "test-grant",
        metadata: {
          description: "Updated Test Grant Description",
          startDate: "2023-01-02T00:00:00Z",
        },
        actions: [
          {
            method: "GET",
            name: "get-test",
            url: "http://localhost:3002/test-grant/get-test",
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
                  ],
                },
              ],
            },
          ],
        },
      },
    });

    expect(replace).toHaveBeenCalledWith(
      new Grant({
        code: "test-grant",
        version: "0.0.0",
        metadata: {
          description: "Updated Test Grant Description",
          startDate: "2023-01-02T00:00:00Z",
        },
        actions: [
          {
            method: "GET",
            name: "get-test",
            url: "http://localhost:3002/test-grant/get-test",
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
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
  });
});

describe("replaceGrantAuditBuilder", () => {
  const command = {
    code: "test-grant",
    metadata: {
      description: "Updated Test Grant Description",
      startDate: "2023-01-02T00:00:00Z",
    },
    actions: [],
  };
  const args = [{ code: "test-grant", command }];

  it("emits REPLACE_GRANT on the GRANT entity with the correct entityid", () => {
    const event = replaceGrantAuditBuilder(args);

    expect(event.entities[0]).toEqual({
      entity: auditEntities.GRANT,
      action: auditActions.REPLACE_GRANT,
      entityid: "test-grant",
    });
  });

  it("includes the new grant command in details", () => {
    const event = replaceGrantAuditBuilder(args);

    expect(event.details).toEqual({ newGrantCommand: command });
  });

  it("sets segregationRef to replace-grant-{code}", () => {
    const event = replaceGrantAuditBuilder(args);

    expect(event.segregationRef).toBe("replace-grant-test-grant");
  });
});
