import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import {
  describeError,
  isCwConfigured,
  notConfiguredMessage,
} from "../repositories/cw-actuators.repository.js";
import { SOURCE_KEYS } from "./event-cursor.js";
import { hopLabel } from "./event-display.js";

// The four sources behind the admin events surface and the failure policy
// they share: the list, the counts and the breakdown all fan out over the
// same four and must report a broken source the same way, so the selection
// and the error vocabulary live here rather than in any one use case.

export const GAS = "gas";
export const CASEWORKING = "caseworking";

// One Caseworking read shared by every section of a page: the page starts it
// ONCE and hands the same promise to all three sections, which still run in
// parallel and degrade independently. A promise rather than an awaited value,
// so nothing waits on Caseworking before starting its own GAS queries; a use
// case invoked without a shared page takes its own read, and nothing is read
// at all when no Caseworking source is selected.
export const selectsCaseworking = (service) =>
  !service || service === CASEWORKING;

export const cwPageFor = (selected, caseworking, read) =>
  selected.some((source) => source.service === CASEWORKING)
    ? (caseworking ?? read())
    : undefined;

// A section Caseworking could not read comes back null and is turned back
// into a rejection here, so a partial Caseworking answer becomes the same
// `sourceError` a failed request would have.
const unavailable = (box, section) =>
  Boom.badGateway(`caseworking ${box} ${section} unavailable`);

// A page that was never read is as unavailable as a section that failed: the
// caller is a fan-out inside `Promise.allSettled`, so either way this becomes
// that source's `sourceError` rather than an exception nobody catches.
export const sectionOfCwPage = async (page, box, section) => {
  const answer = page ? (await page)[box]?.[section] : null;

  return answer ?? Promise.reject(unavailable(box, section));
};

export const toSourceError = (source, message) => ({
  key: source.key,
  service: source.service,
  box: source.box,
  message,
});

// The key is internal scaffolding; the hop label is what the alert names the
// source by, in the same words the rows use for the same pair.
const stripKey = ({ service, box, message }) => ({
  service,
  box,
  hop: hopLabel({ service, box }),
  message,
});

// Ordered by the fixed source order, so two identical failures always read the
// same way round.
export const orderErrors = (errors) =>
  [...errors]
    .sort((a, b) => SOURCE_KEYS.indexOf(a.key) - SOURCE_KEYS.indexOf(b.key))
    .map(stripKey);

// The same fixed order, read off the PUBLIC shape: by the time a composite
// holds these, `orderErrors` has stripped the internal key.
const publicOrder = ({ service, box }) =>
  SOURCE_KEYS.indexOf(
    `${service === CASEWORKING ? "cw" : service}${box === "inbox" ? "Inbox" : "Outbox"}`,
  );

// A composed page reads the same four sources more than once - the list and
// the counts, at least - and either read can lose a source the other kept.
// Both facts belong in one list: a source the list could not read has no rows
// on the page, and a source only the counts could not read leaves the numbers
// short. Reporting the second as nothing at all is what let a failed count
// render as a zero nobody questioned.
//
// Named once, whichever read lost it first, and in the fixed source order so
// the alert reads the same way round every time.
export const mergeSourceErrors = (...groups) => {
  const bySource = new Map();

  for (const error of groups.flat()) {
    const key = `${error.service}/${error.box}`;

    if (!bySource.has(key)) {
      bySource.set(key, error);
    }
  }

  return [...bySource.values()].sort((a, b) => publicOrder(a) - publicOrder(b));
};

// Works on anything carrying a `service`, sources and their results alike.
export const sourcesFor = (items, service) =>
  items.filter((item) => !service || item.service === service);

// With `service=gas` the Caseworking sources are never selected, so an
// unconfigured CW backend produces no sourceError at all.
export const selectSources = (service, sources) => {
  const forService = sourcesFor(sources, service);

  if (isCwConfigured()) {
    return { selected: forService, sourceErrors: [] };
  }

  return {
    selected: forService.filter((source) => source.service !== CASEWORKING),
    sourceErrors: forService
      .filter((source) => source.service === CASEWORKING)
      .map((source) => toSourceError(source, notConfiguredMessage())),
  };
};

// Asymmetric on purpose: `wreck` hangs the CW response body off its error, so a
// caseworking failure is logged as a derived one-liner and never as the error
// object. A GAS failure is our own database - the stack is worth keeping.
const logSourceFailure = (source, error) => {
  if (source.service === CASEWORKING) {
    logger.warn(
      { service: source.service, box: source.box },
      `caseworking ${source.box} unavailable: ${describeError(error)}`,
    );

    return;
  }

  logger.error(error, `gas ${source.box} read failed`);
};

const passValue = (_source, value) => value;

// Splits an `allSettled` fan-out into usable results and `sourceErrors`, so a
// broken source degrades the answer instead of failing it.
export const splitSettled = (selected, settled, onFulfilled = passValue) => {
  const results = [];
  const errors = [];

  selected.forEach((source, index) => {
    const result = settled[index];

    if (result.status === "fulfilled") {
      results.push(onFulfilled(source, result.value));
      return;
    }

    logSourceFailure(source, result.reason);
    errors.push(toSourceError(source, describeError(result.reason)));
  });

  return { results, errors };
};

const countFor = (items, service) => sourcesFor(items, service).length;

// Exactly one GAS source failing is a 200 with a sourceError; both failing
// leaves nothing worth rendering.
export const assertGasAvailable = (selected, errors) => {
  const gasSelected = countFor(selected, GAS);

  if (gasSelected > 0 && gasSelected === countFor(errors, GAS)) {
    throw Boom.badGateway("Events could not be loaded from GAS");
  }
};
