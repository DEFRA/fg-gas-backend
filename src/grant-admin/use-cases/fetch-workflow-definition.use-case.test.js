import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { fetchCwWorkflowDefinition } from "../repositories/cw-workflows.repository.js";
import { fetchWorkflowDefinitionUseCase } from "./fetch-workflow-definition.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/cw-workflows.repository.js", async (original) => ({
  ...(await original()),
  fetchCwWorkflowDefinition: vi.fn(),
}));

const ARGS = {
  code: "Casework-Smoke",
  version: "1.2.0",
  caller: "fg-grants-platform-admin",
  actor: "Jo Operator",
};

const versionNotFound = () => {
  const error = Boom.notFound("workflow version not found");

  error.output.payload.reason = "WORKFLOW_VERSION_NOT_FOUND";

  return error;
};

const fetch = () => fetchWorkflowDefinitionUseCase(ARGS);

const audited = () => writeAuditEvent.mock.calls[0][0];

describe("fetchWorkflowDefinitionUseCase", () => {
  beforeEach(() => {
    writeAuditEvent.mockResolvedValue();
  });

  it("asks Caseworking to fetch, naming the operator, and answers its outcome", async () => {
    const result = { files: [{ file: "workflow", outcome: "stored" }] };
    fetchCwWorkflowDefinition.mockResolvedValue(result);

    expect(await fetch()).toEqual(result);
    expect(fetchCwWorkflowDefinition).toHaveBeenCalledWith(
      { code: "Casework-Smoke", version: "1.2.0" },
      { by: "Jo Operator" },
    );
  });

  it("audits an answered fetch as a SUCCESS on the workflow, each file's outcome without its message", async () => {
    fetchCwWorkflowDefinition.mockResolvedValue({
      files: [
        {
          file: "workflow",
          outcome: "failed",
          reason: "invalid",
          message: "Workflow phases are not unique",
        },
      ],
    });

    await fetch();

    expect(audited()).toEqual({
      entities: [
        {
          entity: "WORKFLOW",
          action: "FETCH_CONFIG_DEFINITION",
          entityid: "Casework-Smoke",
        },
      ],
      accounts: { sbi: undefined, frn: undefined, crn: undefined },
      details: {
        caller: "fg-grants-platform-admin",
        version: "1.2.0",
        files: [{ file: "workflow", outcome: "failed", reason: "invalid" }],
      },
      status: "SUCCESS",
      security: { pmccode: "0706" },
      segregationRef: "fetch-definition-Casework-Smoke",
    });
  });

  it.each([
    ["an unknown version", versionNotFound(), "WORKFLOW_VERSION_NOT_FOUND"],
    [
      "no answer in time",
      Boom.gatewayTimeout("CW-BE workflows did not answer in time"),
      "TIMED_OUT",
    ],
    [
      "Caseworking down",
      Boom.badGateway("CW-BE workflows unavailable: HTTP 500"),
      "UNEXPECTED_FAILURE",
    ],
  ])("audits %s as a FAILURE and rethrows it", async (_name, error, code) => {
    fetchCwWorkflowDefinition.mockRejectedValue(error);

    await expect(fetch()).rejects.toBe(error);
    expect(audited()).toMatchObject({
      status: "FAILURE",
      details: { version: "1.2.0", files: [], errorCode: code },
    });
  });
});
