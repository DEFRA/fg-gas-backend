import Boom from "@hapi/boom";
import { expect, it, vi } from "vitest";
import { findCwWorkflowVersions } from "../repositories/cw-actuators.repository.js";
import { listWorkflowVersionsUseCase } from "./list-workflow-versions.use-case.js";

vi.mock("../repositories/cw-actuators.repository.js");

it("answers Caseworking's versions of the workflow, asked as the operator", async () => {
  const versions = { code: "Casework-Smoke", current: null, versions: [] };
  findCwWorkflowVersions.mockResolvedValue(versions);

  expect(
    await listWorkflowVersionsUseCase({ code: "Casework-Smoke", actor: "Jo" }),
  ).toEqual(versions);
  expect(findCwWorkflowVersions).toHaveBeenCalledWith("Casework-Smoke", {
    actor: "Jo",
  });
});

it("answers Caseworking's 404 as it is", async () => {
  const notFound = Boom.notFound("workflow not found");
  findCwWorkflowVersions.mockRejectedValue(notFound);

  await expect(
    listWorkflowVersionsUseCase({ code: "nowhere", actor: "Jo" }),
  ).rejects.toBe(notFound);
});
