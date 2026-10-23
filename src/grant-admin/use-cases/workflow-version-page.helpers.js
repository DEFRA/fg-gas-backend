import { grantVersionExists } from "../../grants/services/config-version.service.js";
import { findCwWorkflowVersion } from "../repositories/cw-workflows.repository.js";
import { startSharedRead } from "../services/compose-record-page.js";
import { readCounterpart } from "./read-counterpart.js";

export const startWorkflowVersionRead = ({ code, version }, options) =>
  startSharedRead(findCwWorkflowVersion({ code, version }, options));

// A workflow with no grant still has a page.
const readGrantLink = ({ code, version }) =>
  readCounterpart("Workflow version page: grant link", () =>
    grantVersionExists({ code, version }),
  );

export const readWorkflowVersionHeader = async (args) => {
  const [read, counterpart] = await Promise.all([
    args.workflowVersionRead,
    args.withCounterpart ? readGrantLink(args) : null,
  ]);

  return {
    header: {
      code: read.version.grantCode,
      version: read.version.version,
      status: read.version.status,
      receivedAt: read.version.receivedAt,
      s3Bucket: read.version.s3Bucket,
      files: {
        workflow: {
          stored: read.storedBytes !== null,
          fetchStatus: read.version.fetchStatus,
          fetchError: read.version.fetchError,
          fetchAttempts: read.version.fetchAttempts,
          s3Key: read.version.s3Key,
        },
      },
      versions: read.versions,
      counterpart,
    },
    accounts: null,
  };
};
