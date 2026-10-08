import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import {
  describeError,
  isCwConfigured,
} from "../repositories/cw-actuators.repository.js";
import { SOURCE_KEYS } from "./event-cursor.js";
import { hopLabel } from "./event-display.js";

export const GAS = "gas";
export const CASEWORKING = "caseworking";

// How a log line names the service filter when none was chosen.
export const serviceScope = (service) => service ?? "every service";

export const selectsCaseworking = (service) =>
  !service || service === CASEWORKING;

// A null section becomes a rejection, so a partial answer is a `sourceError`.
const unavailable = (box, section) =>
  Boom.badGateway(`caseworking ${box} ${section} unavailable`);

export const sectionOfCwPage = async (page, box, section) => {
  const answer = page ? (await page)[box]?.[section] : null;

  return answer ?? Promise.reject(unavailable(box, section));
};

const sourceOrder = ({ key }) => SOURCE_KEYS.indexOf(key);

// Each section can lose a different source: name each once, in the fixed order.
export const toPublicSourceErrors = (...groups) => {
  const bySource = new Map();

  for (const error of groups.flat()) {
    bySource.set(error.key, error);
  }

  return [...bySource.values()]
    .sort((a, b) => sourceOrder(a) - sourceOrder(b))
    .map(({ service, box }) => ({ hop: hopLabel({ service, box }) }));
};

export const sourcesFor = (items, service) =>
  items.filter((item) => !service || item.service === service);

export const selectSources = (service, sources) => {
  const forService = sourcesFor(sources, service);

  if (isCwConfigured()) {
    return { selected: forService, sourceErrors: [] };
  }

  return {
    selected: forService.filter((source) => source.service !== CASEWORKING),
    sourceErrors: forService
      .filter((source) => source.service === CASEWORKING)
      .map(({ key, box }) => ({ key, service: CASEWORKING, box })),
  };
};

// `wreck` hangs the CW response body off its error, so never log the error itself.
const logSourceFailure = (source, error) => {
  if (source.service === CASEWORKING) {
    logger.warn(
      `caseworking ${source.box} unavailable: ${describeError(error)}`,
    );

    return;
  }

  logger.error(error, `gas ${source.box} read failed`);
};

const passValue = (_source, value) => value;

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
    errors.push({ key: source.key, service: source.service, box: source.box });
  });

  return { results, errors };
};

const countFor = (items, service) => sourcesFor(items, service).length;

// One GAS source failing is a 200 with a sourceError; both is a 502.
export const assertGasAvailable = (selected, errors) => {
  const gasSelected = countFor(selected, GAS);

  if (gasSelected > 0 && gasSelected === countFor(errors, GAS)) {
    throw Boom.badGateway("Events could not be loaded from GAS");
  }
};
