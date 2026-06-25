import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import { Grant } from "../models/grant.js";
import { findByCode, replace } from "../repositories/grant.repository.js";
import { replaceGrantUseCase } from "./replace-grant.use-case.js";

vi.mock("../repositories/grant.repository.js");
vi.mock("../../common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../common/write-audit-event.js", () => ({
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const existingGrant = new Grant({
  code: "test-grant",
  metadata: {
    description: "Test Grant Description",
    startDate: "2023-01-01T00:00:00Z",
  },
  actions: [],
  questions: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
  },
});

const replaceCommand = {
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

describe("replaceGrantUseCase", () => {
  beforeEach(() => {
    writeAuditEvent.mockResolvedValue(undefined);
  });

  it("replaces the whole grant", async () => {
    findByCode.mockResolvedValue(
      new Grant({
        code: "test-grant",
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

    await replaceGrantUseCase("test-grant", {
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
    });

    expect(replace).toHaveBeenCalledWith(
      new Grant({
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
      }),
    );
  });

  it("writes an audit event with SUCCESS status on success", async () => {
    findByCode.mockResolvedValue(existingGrant);

    await replaceGrantUseCase("test-grant", replaceCommand);

    expect(writeAuditEvent).toHaveBeenCalledOnce();
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          { entity: "Grant", action: "REPLACE_GRANT", entityid: "test-grant" },
        ],
        details: {},
        messageGroupId: "test-grant",
        status: "SUCCESS",
      }),
      undefined,
    );
  });

  it("re-throws and writes an audit event with FAILURE status when the use case fails", async () => {
    findByCode.mockRejectedValueOnce(new Error("grant not found"));

    await expect(
      replaceGrantUseCase("test-grant", replaceCommand),
    ).rejects.toThrow("grant not found");

    await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalledOnce());
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILURE" }),
      undefined,
    );
  });

  it("replaces the grant with externalStatusMap", async () => {
    findByCode.mockResolvedValue(
      new Grant({
        code: "test-grant",
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

    await replaceGrantUseCase("test-grant", {
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
    });

    expect(replace).toHaveBeenCalledWith(
      new Grant({
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
      }),
    );
  });
});
