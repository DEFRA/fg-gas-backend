import { logger } from "../../common/logger.js";
import { AUDIT_INCLUDE } from "../../events/event-audit.js";
import { sectionOf } from "../services/page-sections.js";
import { findEventsUseCase } from "./find-events.use-case.js";
import { getEventUseCase } from "./get-event.use-case.js";

// The journey is the list use case asked which rows carry this event id -
// read through `findEventsUseCase` rather than over HTTP against our own list
// endpoint, because the hops are a database question and a route calling its
// own service is a round trip and a second set of failure modes for nothing.
//
// Audit records are asked for explicitly: a journey is "what happened to THIS
// message", so a hop missing from it is a hole in the answer, not noise
// removed from it.
const readJourney = async (eventId, caseworking) => {
  const { hops, pagination } = await findEventsUseCase({
    q: eventId,
    direction: "forward",
    audit: AUDIT_INCLUDE,
    caseworking,
  });

  // The journey is one page of a merged list, so an event with more hops than
  // a page loses the OLDEST of them - the origin, which is the worst end to
  // drop silently. Saying so is cheap; a page that quietly shows four hops of
  // six is a page that answers "where did this go?" wrongly and looks right.
  return { hops, truncated: Boolean(pagination?.hasNextPage) };
};

// A Caseworking detail answer already carries both of its boxes searched for
// this event's id, so the journey has nothing left to ask it for: the rows
// are handed to the fan-out in the shape a page read would have produced. A
// GAS event brings none, and the fan-out makes the one request itself.
const toCwPage = (hops) =>
  hops === null
    ? undefined
    : Promise.resolve({
        inbox: toCwSection(hops.inbox),
        outbox: toCwSection(hops.outbox),
      });

const toCwSection = (rows) => ({
  list: rows === null ? null : { data: rows, pagination: {} },
  // A journey asks for rows and nothing else; a section nothing reads is null
  // rather than an invented empty one.
  facets: null,
  groups: null,
});

// NOT a parallel fan-out, unlike the events page: the journey is a search for
// the event's `eventId`, and nothing knows that id until the detail read has
// answered - the URL addresses a row by its Mongo `_id`.
//
// The detail is the page: a 404 stays a 404, a 502 stays a 502, and the audit
// event `getEventUseCase` writes is written exactly once, whatever the
// journey does. Only the journey degrades - to a null and a named
// `sectionErrors` entry.
// A journey that could not be read is absent, not truncated: the page already
// says the first with `journey: null`, and saying the second as well would be
// claiming to know something about hops nobody counted.
const NO_JOURNEY = { hops: null, truncated: false };

export const eventDetailPageUseCase = async ({ service, box, id, caller }) => {
  logger.info(`Event detail page ${service}/${box}/${id}`);

  const { event, cwHops } = await getEventUseCase({ service, box, id, caller });

  const [journey] = await Promise.allSettled([
    readJourney(event.eventId, toCwPage(cwHops)),
  ]);

  const sectionErrors = [];
  const read = sectionOf("journey", journey, sectionErrors) ?? NO_JOURNEY;

  logger.info(
    `Finished: Event detail page ${service}/${box}/${id} (${read.hops?.length ?? 0} hops)`,
  );

  return {
    ...event,
    journey: read.hops,
    // Whether there were more hops than a page. Never null: a journey that
    // could not be read is not a truncated one, it is an absent one, and the
    // page already says that with `journey: null`.
    journeyTruncated: read.truncated,
    sectionErrors,
  };
};
