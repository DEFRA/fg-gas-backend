import { saveEvents } from "../../events/index.js";
import { createApplicationStatusReportingPublication } from "../events/application-status-reporting.event.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";

const reportingStatusAt = (grant, { phase, stage, status }) =>
  grant.findStatusDefinition(phase, stage, status)?.reporting?.status;

const initialReportingStatusFor = (grant) =>
  grant.getInitialState().status.reporting?.status;

const previousReportingStatusFor = (grant, application, position, initial) =>
  application.lastReportedStatus ??
  reportingStatusAt(grant, position) ??
  initial;

// A transition process can complete the withdrawal inside this
// transaction. Read the final position and preserve any process updates.
const applicationAfterProcesses = async (application, reload, session) => {
  if (!reload) {
    return application;
  }

  const { code, clientRef } = application;
  return findByClientRefAndCode({ code, clientRef }, session);
};

export const reportApplicationStatusChange = async (
  { application, grant, previousPosition, reload, userId },
  session,
) => {
  const initialReportingStatus = initialReportingStatusFor(grant);
  if (!initialReportingStatus) {
    return;
  }

  const saved = await applicationAfterProcesses(application, reload, session);
  const applicationStatus = reportingStatusAt(grant, saved.currentPosition());
  const previousApplicationStatus = previousReportingStatusFor(
    grant,
    saved,
    previousPosition,
    initialReportingStatus,
  );
  if (!applicationStatus || applicationStatus === previousApplicationStatus) {
    return;
  }

  const publication = createApplicationStatusReportingPublication({
    application: saved,
    previousApplicationStatus,
    applicationStatus,
    userId,
  });
  saved.lastReportedStatus = applicationStatus;
  await update(saved, session);
  await saveEvents([publication], session);
};
