import Boom from "@hapi/boom";
import Joi from "joi";
import { readTimeoutMs } from "../../common/buckets/engine.js";
import { REFUSAL_REASONS, refuse } from "../../common/buckets/refusal.js";
import { PAGE_SIZE, queryRequestSchema } from "../../common/buckets/schema.js";
import { logger } from "../../common/logger.js";
import {
  RANGE_KEYS,
  fromUrlQuery,
  repeatedKeys,
  unknownKeys,
  unknownValues,
} from "../services/list-address.js";
import { CW_UNREACHABLE } from "../repositories/cw-http.js";
import { groupReaderFor } from "../services/list-groups/reader.js";
import { mayBeCwList, readListShell } from "../services/shell-cache.js";
import { queryBucketUseCase } from "./query-bucket.use-case.js";

// Keys of a list's URL that page or switch it, never a filter; the range keys
// are the address rules' own.
const PAGING_KEYS = new Set([
  "cursor",
  "page",
  "through",
  "searched",
  "clear",
  "audit",
]);

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const SERVER_ERROR = 500;
const UNAVAILABLE = 503;
const GATEWAY_TIMEOUT = 504;

const refusal = (statusCode, code, message, fields = {}) => {
  const error = new Boom.Boom(message, { statusCode });

  Object.assign(error.output.payload, { code, ...fields });

  return error;
};

const cwUnreachable = () =>
  refusal(UNAVAILABLE, CW_UNREACHABLE, "CW-BE lists could not be read");

const isCwMissing = ({ sourceErrors }) =>
  sourceErrors.some(({ hop }) => hop === "CW-BE");

// Only a path Caseworking last listed waits on it, or any path before it has
// been read once.
const noListAt = (catalogue, path) =>
  isCwMissing(catalogue) && mayBeCwList(path)
    ? cwUnreachable()
    : refusal(NOT_FOUND, "LIST_NOT_FOUND", "No list has this path");

// The catalogue is the one every answer carries, so the list a page names is
// the one it draws; a group's comes with what its read splits by.
const findEntry = async (path) => {
  const shell = await readListShell();

  if (shell === null) {
    throw refusal(
      UNAVAILABLE,
      "CATALOGUE_UNAVAILABLE",
      "The list catalogue could not be read",
    );
  }

  const entry = shell.catalogue.buckets.find((bucket) => bucket.path === path);

  if (entry) {
    return { entry, view: shell.groups.get(entry.id) ?? null };
  }

  throw noListAt(shell.catalogue, path);
};

const addressOf = (params) =>
  Object.fromEntries(
    Object.entries(params).filter(([key]) => !PAGING_KEYS.has(key)),
  );

const checkAddress = (entry, address) => {
  const problems = {
    unknownKeys: unknownKeys(entry, address),
    repeatedKeys: repeatedKeys(entry, address),
    unknownValues: unknownValues(entry, address),
  };

  if (Object.values(problems).some((keys) => keys.length > 0)) {
    throw refusal(
      BAD_REQUEST,
      "ADDRESS_REFUSED",
      "The address names keys or values this list does not offer",
      { problems, bucket: entry.id },
    );
  }
};

const isInstant = (value) =>
  value === undefined || !Joi.string().isoDate().validate(value).error;

const isOrdered = ({ from, to }) =>
  from === undefined || to === undefined || Date.parse(from) <= Date.parse(to);

const checkRange = (entry, ask) => {
  if (!isInstant(ask.from) || !isInstant(ask.to) || !isOrdered(ask)) {
    throw refusal(
      BAD_REQUEST,
      "RANGE_REFUSED",
      '"from" and "to" must be instants, "from" no later than "to"',
      { bucket: entry.id },
    );
  }
};

// One value as itself, several as a list, none left out.
const whereOf = (entry, address) =>
  Object.fromEntries(
    Object.entries(fromUrlQuery(entry, address))
      .filter(([name]) => !RANGE_KEYS.includes(name))
      .flatMap(([name, value]) => {
        const values = [value ?? []].flat();

        return values.length > 0
          ? [[name, values.length === 1 ? values[0] : values]]
          : [];
      }),
  );

const defined = (fields) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );

const toBody = (fields) => {
  const { value, error } = queryRequestSchema.validate(defined(fields));

  if (error) {
    throw refuse("INVALID_REQUEST");
  }

  return value;
};

const statusOf = (error) => error.output?.statusCode ?? SERVER_ERROR;

const CODE_KEYS = ["reason", "code", "errorCode"];

const codeOf = (error) => {
  const payload = error.output?.payload ?? {};

  return CODE_KEYS.map((key) => payload[key]).find(Boolean) ?? null;
};

const refusalOf = (error) =>
  REFUSAL_REASONS.includes(error.output.payload.reason)
    ? error.output.payload.message
    : null;

// A refused search would only fail again: the list's first page is read
// without it, so the rows show under the refusal.
const readFirst = async (reader, ask) => {
  try {
    return { page: await reader.first(true), refusedSearch: null };
  } catch (error) {
    if (ask.search === null || statusOf(error) !== BAD_REQUEST) {
      throw error;
    }

    return {
      page: await reader.first(false),
      refusedSearch: { refusal: refusalOf(error) },
    };
  }
};

// A group's first page that can't reach Caseworking at all is the same answer
// as its lists not read: no one queue failed, so none is named. Any other read
// fails as itself, so a later page keeps its rows and names its queue.
const isCwNotReached = (error) =>
  error.output?.payload.errorCode === CW_UNREACHABLE;

const listFailureOf = (view, ask) => (error) => {
  const isGroupFirst = view !== null && ask.cursor === undefined;

  throw isGroupFirst && isCwNotReached(error) ? cwUnreachable() : error;
};

// A bounded read goes on where it stopped, as Keep looking does.
const nextOf = ({ page }) => page.next ?? page.keepLooking;

const isDone = (cursor, pages, wanted) =>
  cursor === null || pages.length >= wanted;

const lateAt = (reader, cursor) =>
  Date.now() >= reader.deadline
    ? { cursor, statusCode: GATEWAY_TIMEOUT, code: "TIMED_OUT" }
    : null;

// A failed read of one bucket of several names its queue.
const queueOf = (error) => {
  const queue = error.output?.payload.queue;

  return queue === undefined ? {} : { queue };
};

const readLater = async (reader, cursor) => {
  try {
    return { page: await reader.later(cursor), stopped: null };
  } catch (error) {
    return {
      page: null,
      stopped: {
        cursor,
        statusCode: statusOf(error),
        code: codeOf(error),
        ...queueOf(error),
      },
    };
  }
};

const readOn = async (reader, pages, wanted) => {
  const cursor = nextOf(pages.at(-1));

  if (isDone(cursor, pages, wanted)) {
    return { pages, stopped: null };
  }

  const late = lateAt(reader, cursor);

  if (late) {
    return { pages, stopped: late };
  }

  const { page, stopped } = await readLater(reader, cursor);

  return stopped
    ? { pages, stopped }
    : readOn(reader, [...pages, page], wanted);
};

// Every page shown as one: its rows, the first page's total, the last's way on.
const joined = (pages) => ({
  ...pages.at(-1),
  rows: pages.flatMap(({ rows }) => rows),
  ...(pages[0].total === undefined ? {} : { total: pages[0].total }),
});

// Each page is read, and audited, as the list's own query reads it: only the
// first counts, and every later one is a repeat. A group reads each of its
// members so.
const readerFor = (entry, view, ask, who) => {
  const where = whereOf(entry, addressOf(ask.params));
  const deadline = Date.now() + readTimeoutMs();
  const readMember = ({
    bucketId,
    where: memberWhere,
    fields,
    repeat,
    signal,
  }) =>
    queryBucketUseCase({
      bucketId,
      body: toBody({
        where: memberWhere,
        limit: PAGE_SIZE,
        from: ask.from,
        to: ask.to,
        ...fields,
      }),
      ...who,
      repeat,
      deadline,
      signal,
    });

  if (view !== null) {
    return groupReaderFor({ view, where, ask, deadline, readMember });
  }

  const read = (fields, repeat) =>
    readMember({ bucketId: entry.id, where, fields, repeat });

  return {
    deadline,
    first: (withSearch) =>
      withSearch
        ? read(
            {
              ref: ask.search ?? undefined,
              cursor: ask.cursor,
              count: ask.count,
            },
            ask.repeat,
          )
        : read({ count: ask.count }, false),
    later: (cursor) => read({ ref: ask.search ?? undefined, cursor }, true),
  };
};

const readList = async ({ entry, view }, ask, who) => {
  const reader = readerFor(entry, view, ask, who);
  const first = await readFirst(reader, ask).catch(listFailureOf(view, ask));
  const { pages, stopped } =
    first.refusedSearch === null
      ? await readOn(reader, [first.page], ask.pages)
      : { pages: [first.page], stopped: null };

  return {
    ...joined(pages),
    pageRows: pages.map(({ rows }) => rows.length),
    stopped,
    refusedSearch: first.refusedSearch,
  };
};

// The address is checked before the range, and both before any read, so a
// refused list writes no audit.
export const queryListUseCase = async ({ ask, caller, actor }) => {
  logger.info("Query list");

  const found = await findEntry(ask.path);
  const { entry } = found;

  checkAddress(entry, addressOf(ask.params));
  checkRange(entry, ask);

  const list = ask.read ? await readList(found, ask, { caller, actor }) : null;

  logger.info(
    `Finished: Query list ${entry.id} (${list ? list.rows.length : 0} rows)`,
  );

  return { bucket: entry.id, list };
};
