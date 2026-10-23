import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { grantVersionExists } from "../../grants/services/config-version.service.js";
import { findCwWorkflowVersion } from "../repositories/cw-workflows.repository.js";
import {
  readWorkflowVersionHeader,
  startWorkflowVersionRead,
} from "./workflow-version-page.helpers.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/config-version.service.js");
vi.mock("../repositories/cw-workflows.repository.js");

const REF = { code: "woodland", version: "2.0.0" };

const VERSIONS = [
  { version: "2.0.0", status: "draft", receivedAt: "2026-10-15T10:04:00.000Z" },
];

const aRead = (overrides = {}) => ({
  version: {
    grantCode: "woodland",
    version: "2.0.0",
    status: "draft",
    receivedAt: "2026-10-15T10:04:00.000Z",
    fetchStatus: "pending",
  },
  versions: VERSIONS,
  current: null,
  storedBytes: null,
  summary: null,
  ...overrides,
});

const header = (read, withCounterpart = false) =>
  readWorkflowVersionHeader({
    ...REF,
    workflowVersionRead: Promise.resolve(read),
    withCounterpart,
  });

describe("startWorkflowVersionRead", () => {
  it("reads the version once, with the options given", async () => {
    findCwWorkflowVersion.mockResolvedValue(aRead());

    await startWorkflowVersionRead(REF, { actor: "Jo", include: "document" });

    expect(findCwWorkflowVersion).toHaveBeenCalledWith(REF, {
      actor: "Jo",
      include: "document",
    });
  });
});

describe("readWorkflowVersionHeader", () => {
  it("answers the version, its workflow file not stored with the row's fetch status, and its versions", async () => {
    const { header: drawn, accounts } = await header(aRead());

    expect(drawn).toEqual({
      code: "woodland",
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
      files: { workflow: { stored: false, fetchStatus: "pending" } },
      versions: VERSIONS,
      counterpart: null,
    });
    expect(accounts).toBeNull();
    expect(grantVersionExists).not.toHaveBeenCalled();
  });

  it("passes on the workflow file's fetch state, where it is and each version's fetch state", async () => {
    const versions = [{ ...VERSIONS[0], fetchStatus: "pending", stored: true }];
    const read = aRead({ versions });
    read.version = {
      ...read.version,
      fetchStatus: "transient_error",
      fetchError: "S3 timed out",
      fetchAttempts: 2,
      s3Key: "woodland/2.0.0/cw/workflow.json",
      s3Bucket: "config-broker-local",
    };

    const { header: drawn } = await header(read);

    expect(drawn).toMatchObject({
      s3Bucket: "config-broker-local",
      files: {
        workflow: {
          stored: false,
          fetchStatus: "transient_error",
          fetchError: "S3 timed out",
          fetchAttempts: 2,
          s3Key: "woodland/2.0.0/cw/workflow.json",
        },
      },
      versions,
    });
  });

  it("says the workflow is stored when Caseworking has its size", async () => {
    const { header: drawn } = await header(aRead({ storedBytes: 48213 }));

    expect(drawn.files.workflow.stored).toBe(true);
  });

  it.each([true, false])(
    "says whether GAS has the grant version (%s) when asked",
    async (exists) => {
      grantVersionExists.mockResolvedValue(exists);

      const { header: drawn } = await header(aRead(), true);

      expect(drawn.counterpart).toEqual({ exists });
      expect(grantVersionExists).toHaveBeenCalledWith(REF);
    },
  );

  it("leaves the grant link unknown when GAS cannot read it", async () => {
    grantVersionExists.mockRejectedValue(new Error("mongo down"));

    const { header: drawn } = await header(aRead(), true);

    expect(drawn.counterpart).toBeNull();
  });

  it("fails with Caseworking's own failure", async () => {
    const notFound = Boom.notFound("workflow version not found");

    await expect(
      readWorkflowVersionHeader({
        ...REF,
        workflowVersionRead: Promise.reject(notFound),
      }),
    ).rejects.toBe(notFound);
  });
});
