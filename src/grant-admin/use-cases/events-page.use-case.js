import { logger } from "../../common/logger.js";
import { findCwPage } from "../repositories/cw-actuators.repository.js";
import { decodeCompositeCursor } from "../services/event-cursor.js";
import {
  serviceVocabulary,
  statusVocabulary,
} from "../services/event-display.js";
import {
  mergeSourceErrors,
  selectsCaseworking,
} from "../services/event-sources.js";
import { PAGE_SIZE } from "../services/merge-event-pages.js";
import { sectionOf } from "../services/page-sections.js";
import { breakdownEventsUseCase } from "./breakdown-events.use-case.js";
import { countEventsUseCase } from "./count-events.use-case.js";
import { findEventsUseCase } from "./find-events.use-case.js";

// The whole events page in one read: the list, the status counts and the
// dead-letter breakdown.
//
// Each section keeps its own filter vocabulary - the list takes every
// parameter, the counts take everything but `status` (which they group by),
// the breakdown takes neither `status` nor `error` - so all three select the
// same rows and the groups still add up to the DEAD_LETTER count beside them.
// `audit` is the exception that reaches all three unchanged: it decides which
// population the page is about, not which slice of it to show, and a number
// computed over a different population from the rows beneath it would be
// wrong.
const readCaseworkingPage = ({ service, cursor, ...filters }) => {
  if (!selectsCaseworking(service)) {
    return undefined;
  }

  const page = findCwPage({
    ...filters,
    slices: decodeCompositeCursor(cursor),
    pageSize: PAGE_SIZE,
  });

  // Every section awaits this inside its own `Promise.allSettled`, so a
  // rejection becomes a `sourceError`. The no-op handler covers the path
  // where a section throws before it gets that far: a promise nobody awaited
  // must not take the process down with an unhandled rejection. It swallows
  // nothing - the promise still rejects for its real consumers.
  page.catch(() => {});

  return page;
};

// A counts section that failed outright is a `sectionError` and contributes no
// source errors of its own; this reads the partial case, where the section
// answered but one of the four sources inside it did not.
const countedSourceErrors = (section) => section?.sourceErrors ?? [];

export const eventsPageUseCase = async ({
  cursor,
  direction,
  status,
  service,
  q,
  error,
  from,
  to,
  audit,
}) => {
  logger.info(`Events page (direction ${direction})`);

  // Every page turn pays for the counts and the breakdown aggregations even
  // when the frontend draws neither - the accepted trade-off for one round
  // trip from the browser instead of three.
  //
  // ONE Caseworking read for the whole page: the same promise is handed to
  // all three sections, which still run in parallel and degrade
  // independently. Started rather than awaited, so nothing waits on
  // Caseworking before the GAS queries begin.
  const caseworking = readCaseworkingPage({
    cursor,
    direction,
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
      direction,
      status,
      service,
      q,
      error,
      from,
      to,
      audit,
      caseworking,
    }),
    countEventsUseCase({ service, q, error, from, to, audit, caseworking }),
    breakdownEventsUseCase({ service, q, from, to, audit, caseworking }),
  ]);

  // The list is the page: a missing section leaves a hole the frontend
  // renders around, a missing list leaves nothing to render, so its failure
  // is the call's failure and keeps whatever status it threw.
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
    // Named rather than spread: `findEventsUseCase` also answers with the
    // journey's shape of the same page, which this response has no use for.
    events: list.value.events,
    pagination: list.value.pagination,
    // Both reads' losses, named once each: a source the counts could not read
    // leaves the numbers short even where the list had its rows, and the page
    // must say so rather than render a silently low figure.
    sourceErrors: mergeSourceErrors(
      list.value.sourceErrors,
      countedSourceErrors(countsSection),
    ),
    // Constants of the API, riding every page: a frontend holding its own
    // copy could disagree with the badges beside them.
    statuses: statusVocabulary(),
    services: serviceVocabulary(),
    // Just the six numbers; whichever source could not be counted is named in
    // `sourceErrors` above.
    counts: countsSection?.counts ?? null,
    // The breakdown's whole answer, its own `sourceErrors` included.
    breakdown: breakdownSection,
    sectionErrors,
  };
};
