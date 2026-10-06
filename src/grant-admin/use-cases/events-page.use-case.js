import { logger } from "../../common/logger.js";
import { DEAD_LETTER } from "../../events/event-redrive.js";
import {
  serviceVocabulary,
  statusVocabulary,
} from "../services/event-display.js";
import {
  serviceScope,
  toPublicSourceErrors,
} from "../services/event-sources.js";
import { sectionOf } from "../services/page-sections.js";
import { breakdownEventsUseCase } from "./breakdown-events.use-case.js";
import { readCaseworkingPage } from "./caseworking-page.helpers.js";
import { countEventsUseCase } from "./count-events.use-case.js";
import { findEventsUseCase } from "./find-events.use-case.js";

// A load-more page draws rows only; Top errors show only for no status or dead letters.
const sectionsFor = ({ cursor, status }) => ({
  counts: !cursor,
  breakdown: !cursor && (!status || status === DEAD_LETTER),
});

const cwSections = (sections) => [
  "list",
  ...(sections.counts ? ["counts"] : []),
  ...(sections.breakdown ? ["breakdown"] : []),
];

const sectionSourceErrors = (section) => section?.sourceErrors ?? [];

const breakdownGroups = (section) =>
  section === null ? null : { groups: section.groups };

// A skipped section answers null with no error: nothing failed.
const unlessSkipped = (reads, read) => (reads ? read() : null);

export const eventsPageUseCase = async ({
  cursor,
  status,
  service,
  q,
  error,
  from,
  to,
  audit,
}) => {
  logger.info(`Events page (${serviceScope(service)})`);

  const sections = sectionsFor({ cursor, status });

  // Shared by all three sections, so they read the same Caseworking rows.
  const caseworking = readCaseworkingPage({
    cursor,
    sections: cwSections(sections),
    status,
    service,
    q,
    error,
    from,
    to,
    audit,
  });

  const [list, counts, breakdown] = await Promise.allSettled([
    findEventsUseCase({
      cursor,
      status,
      service,
      q,
      error,
      from,
      to,
      audit,
      caseworking,
    }),
    unlessSkipped(sections.counts, () =>
      countEventsUseCase({ service, q, error, from, to, audit, caseworking }),
    ),
    unlessSkipped(sections.breakdown, () =>
      breakdownEventsUseCase({ service, q, from, to, audit, caseworking }),
    ),
  ]);

  // The list is the page, so its failure is the call's failure.
  if (list.status === "rejected") {
    throw list.reason;
  }

  const sectionErrors = [];
  const countsSection = sectionOf("counts", counts, sectionErrors);
  const breakdownSection = sectionOf("breakdown", breakdown, sectionErrors);

  logger.info(
    `Finished: Events page (${list.value.events.length} rows, ${sectionErrors.length} section errors)`,
  );

  return {
    events: list.value.events,
    pagination: list.value.pagination,
    // Every section's, or a lost source renders as a silently low figure.
    sourceErrors: toPublicSourceErrors(
      list.value.sourceErrors,
      sectionSourceErrors(countsSection),
      sectionSourceErrors(breakdownSection),
    ),
    statuses: statusVocabulary(),
    services: serviceVocabulary(),
    counts: countsSection?.counts ?? null,
    breakdown: breakdownGroups(breakdownSection),
    sectionErrors,
  };
};
