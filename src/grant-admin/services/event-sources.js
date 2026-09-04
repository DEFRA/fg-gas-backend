import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import {
  describeError,
  isCwConfigured,
  notConfiguredMessage,
} from "../repositories/cw-actuators.repository.js";
import { SOURCE_KEYS } from "./event-cursor.js";

// The four sources behind the admin events surface - GAS inbox, GAS outbox,
// Caseworking inbox, Caseworking outbox - and the failure policy they share.
// The list and the counts endpoints fan out over the same four and must report
// a broken source the same way, so the selection and the error vocabulary live
// here rather than in either use case.

export const GAS = "gas";
export const CASEWORKING = "caseworking";

export const toSourceError = (source, message) => ({
  key: source.key,
  service: source.service,
  box: source.box,
  message,
});

const stripKey = ({ service, box, message }) => ({ service, box, message });

// Ordered by the fixed source order, so two identical failures always read the
// same way round.
export const orderErrors = (errors) =>
  [...errors]
    .sort((a, b) => SOURCE_KEYS.indexOf(a.key) - SOURCE_KEYS.indexOf(b.key))
    .map(stripKey);

// Everything belonging to one service, or everything when no service is named.
// Used to pick which sources to read, and - by the counts merge - to pick which
// of the answers a `service`-filtered block may include. Works on anything
// carrying a `service`, sources and their results alike.
export const sourcesFor = (items, service) =>
  items.filter((item) => !service || item.service === service);

// With `service=gas` the Caseworking sources are never selected, so an
// unconfigured CW backend produces no sourceError at all.
//
// The list and the counts endpoints both select this way. The counts endpoint
// used to be the exception - it passed no service and read all four, because
// its `byService` block had to answer for the service the operator did NOT
// select - and that block no longer exists.
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

const valueOf = (source, value) => value;

// Splits an `allSettled` fan-out into usable results and `sourceErrors`, so a
// broken source degrades the answer instead of failing it. `onFulfilled` maps
// one source's answer into whatever the caller merges; the counts endpoint
// takes the answer as it stands.
export const splitSettled = (selected, settled, onFulfilled = valueOf) => {
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
