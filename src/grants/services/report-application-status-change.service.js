import { saveEvents } from "../../events/index.js";
import { createApplicationStatusReportingPublication } from "../events/application-status-reporting.event.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";

export const reportApplicationStatusChange = async (
  { application, previousApplicationStatus, reload, userId },
  session,
) => {
  const { code, clientRef } = application;
  // A transition process can set the final status in this transaction.
  const saved = reload
    ? await findByClientRefAndCode({ code, clientRef }, session)
    : application;

  if (saved.currentStatus === previousApplicationStatus) {
    return;
  }

  const publication = createApplicationStatusReportingPublication({
    application: saved,
    previousApplicationStatus,
    userId,
  });
  await saveEvents([publication], session);
};
