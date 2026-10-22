import {
  readBucketTimeline,
  readTimeline,
} from "../../common/buckets/engine.js";
import { logger } from "../../common/logger.js";
import {
  toApplicationLink,
  toCaseLink,
  toConfigLink,
} from "../../events/case-refs.js";
import { UNRECOGNISED } from "../../events/event-types.js";
import {
  readCwBucketTimeline,
  readCwTimeline,
} from "../repositories/cw-actuators.repository.js";
import { describeError } from "../repositories/cw-http.js";
import {
  latency,
  latencyTitle,
  statusDisplay,
} from "../services/event-display.js";

const CW_UNAVAILABLE = { buckets: [], sourceErrors: [{ hop: "CW-BE" }] };

const newestFirst = (a, b) =>
  b.time.localeCompare(a.time) || b.id.localeCompare(a.id);

const toEventRow = ({ id, time, title, subtitle, cells, link }) => ({
  service: link.service,
  box: link.box,
  id: link.id,
  eventId: subtitle ?? id,
  type: title ?? UNRECOGNISED,
  status: cells.status,
  ...statusDisplay(cells.status),
  createdAt: time,
  latency: latency(time, cells.completedAt),
  latencyTitle: latencyTitle(link.box),
});

const isRead = ({ rows }) => rows !== null;

const toEvents = ({ buckets, sourceErrors = [] }) => {
  const read = buckets.filter(isRead);

  return {
    content: {
      events: {
        rows: read
          .flatMap(({ rows }) => rows)
          .sort(newestFirst)
          .map(toEventRow),
        more: read.some(({ more }) => more),
      },
    },
    sourceErrors: [
      ...sourceErrors,
      ...buckets
        .filter((bucket) => !isRead(bucket))
        .map(({ label }) => ({ hop: label })),
    ],
  };
};

// A link with no grant code or reference reads no bucket, so it is refused
// here rather than shown as every bucket failing.
const applicationLinkOf = (code, clientRef) => {
  const link = toApplicationLink(code, clientRef);

  if (link === null) {
    throw new Error(
      "An application's events need its grant code and reference",
    );
  }

  return link;
};

// An application lives in this service: its Events tab is its link read in
// this service's timeline buckets, and asks Caseworking nothing. It is keyed by
// the grant as well, since two grants may hold the same reference.
export const readApplicationEventsUseCase = async ({ code, clientRef }) =>
  toEvents(await readTimeline(applicationLinkOf(code, clientRef)));

const readFromCaseworking = async (source, read) => {
  try {
    return await read();
  } catch (error) {
    logger.warn(`${source}: caseworking unavailable (${describeError(error)})`);

    return CW_UNAVAILABLE;
  }
};

// A case lives in Caseworking: its Events tab is Caseworking's own timeline,
// read in one call, and none of this service's boxes. It is keyed by the
// workflow as well, since two workflows may hold the same case reference.
export const readCaseEventsUseCase = async ({ workflowCode, caseRef, actor }) =>
  toEvents(
    await readFromCaseworking("Case events", () =>
      readCwTimeline(toCaseLink(workflowCode, caseRef), { actor }),
    ),
  );

// A grant's config versions live in this service: a version's Events tab is
// the inbox rows linked to that version, and asks Caseworking nothing.
export const readGrantVersionEventsUseCase = async ({ code, version }) =>
  toEvents(await readBucketTimeline("gas.inbox", toConfigLink(code, version)));

// A workflow's config versions live in Caseworking: a version's Events tab is
// Caseworking's inbox rows linked to that version.
export const readWorkflowVersionEventsUseCase = async ({
  code,
  version,
  actor,
}) =>
  toEvents(
    await readFromCaseworking("Workflow events", () =>
      readCwBucketTimeline("cw.inbox", toConfigLink(code, version), { actor }),
    ),
  );
