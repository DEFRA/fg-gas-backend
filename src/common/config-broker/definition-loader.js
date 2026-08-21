import Boom from "@hapi/boom";
import { FetchStatus } from "../fetch-status.js";
import { logger } from "../logger.js";
import { fetchConfigFile, S3FetchError } from "../s3-client.js";
import { parseSemver } from "../semver.js";
import {
  findConfigDefinition,
  findLatestUsableDefinition,
  updateDefinitionFetchStatus,
} from "./config-catalog.repository.js";

// Missing, forbidden or unparseable files cannot recover on retry.
const s3FailureStatus = (error) =>
  error.isPermanent || error.isParseError
    ? FetchStatus.PermanentError
    : FetchStatus.TransientError;

// Boom errors identify invalid definitions; other errors may be transient.
const definitionFailureStatus = (error) =>
  error.isBoom ? FetchStatus.PermanentError : FetchStatus.TransientError;

const recorded = (status) => ({ status, record: true });

export const defaultClassifyFailure = (error) =>
  error instanceof S3FetchError
    ? recorded(s3FailureStatus(error))
    : recorded(definitionFailureStatus(error));

/**
 * Loads one Definition Type from the Config Catalog: resolve a target version,
 * fetch it, compile it, cache it, and latch its FetchStatus so a broken version
 * is not re-fetched on every request.
 *
 * Callers supply what actually varies — the Definition Type, how to compile the
 * raw definition, and which resolution strategy applies. Everything else is the
 * same for every type, and drifted between copies when it was not.
 */
export const createDefinitionLoader = ({
  definitionType,
  // Domain term used in error and log messages ("Payment definition ...").
  // definitionType itself stays lowercase for catalog keys and event actions.
  label,
  compile,
  classifyFailure = defaultClassifyFailure,
  readStored,
  writeStored,
}) => {
  const compiled = new Map();
  const loadsInFlight = new Map();

  const missing = (code, version) =>
    Boom.badImplementation(
      `${label} definition "${code}" version "${version}" is unavailable`,
    );

  const parseVersion = (version) => {
    const parsed = typeof version === "string" ? parseSemver(version) : null;
    if (!parsed) {
      throw missing("unknown", version);
    }
    return parsed;
  };

  const updateStatus = (target, fetchStatus, fetchError = null) =>
    updateDefinitionFetchStatus({
      grantCode: target.grantCode,
      version: target.version,
      definitionType,
      fetchStatus,
      fetchError,
    });

  const resolveExact = ({ code, configVersion }) =>
    findConfigDefinition({
      grantCode: code,
      version: configVersion,
      definitionType,
    });

  const resolveSameMajor = ({ code, configVersion }) => {
    const { major } = parseVersion(configVersion);
    return findLatestUsableDefinition({
      grantCode: code,
      major,
      definitionType,
    });
  };

  const resolveCreation = async (options) => {
    const parsed = parseVersion(options.configVersion);
    const exact = await resolveExact(options);

    if (
      exact?.status === "active" &&
      exact.fetchStatus !== FetchStatus.PermanentError
    ) {
      return exact;
    }

    return findLatestUsableDefinition({
      grantCode: options.code,
      ...parsed,
      definitionType,
    });
  };

  // Exact resolution is pinned; the others may fall back to older versions.
  const resolutions = {
    creation: { resolve: resolveCreation, canFallBack: true },
    "same-major": { resolve: resolveSameMajor, canFallBack: true },
    exact: { resolve: resolveExact, canFallBack: false },
  };

  const resolveTarget = async (options) => {
    const resolution = resolutions[options.resolution];
    if (!resolution) {
      throw Boom.badImplementation(
        `Unknown ${label} definition resolution "${options.resolution}"`,
      );
    }

    const target = await resolution.resolve(options);
    if (!target) {
      throw missing(options.code, options.configVersion);
    }
    return target;
  };

  const fetchRaw = async (target) => {
    const stored = readStored ? await readStored(target) : undefined;

    return {
      raw: stored ?? (await fetchConfigFile(target.s3Bucket, target.s3Key)),
      fromStore: Boolean(stored),
    };
  };

  const compileAndCache = async (target, cacheKey) => {
    const { raw, fromStore } = await fetchRaw(target);
    const definition = compile(raw, {
      code: target.grantCode,
      configVersion: target.version,
    });

    if (!fromStore && writeStored) {
      await writeStored(target, raw);
    }
    if (target.fetchStatus !== FetchStatus.Fetched) {
      await updateStatus(target, FetchStatus.Fetched);
    }

    compiled.set(cacheKey, definition);
    return definition;
  };

  const load = async (target, cacheKey) => {
    // Only permanent failures make a version unusable.
    if (target.fetchStatus === FetchStatus.PermanentError) {
      throw missing(target.grantCode, target.version);
    }

    try {
      return await compileAndCache(target, cacheKey);
    } catch (error) {
      const { status, record } = classifyFailure(error);
      if (record) {
        await updateStatus(target, status, error.message);
      }
      // CDP indexes event.action and ECS error fields.
      logger.error(
        {
          error,
          event: { action: `${definitionType}-definition-load-failed` },
        },
        `${label} definition load failed for ${target.grantCode}@${target.version}`,
      );
      throw error;
    }
  };

  const loadCached = (target) => {
    const cacheKey = `${target.grantCode}@${target.version}`;
    const cached = compiled.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Share concurrent loads for the same version.
    const existing = loadsInFlight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const loading = load(target, cacheKey).finally(() =>
      loadsInFlight.delete(cacheKey),
    );
    loadsInFlight.set(cacheKey, loading);
    return loading;
  };

  // Fall back only when the selected version is permanently unusable.
  const shouldFallBack = (resolution, error) =>
    resolutions[resolution].canFallBack &&
    classifyFailure(error).status === FetchStatus.PermanentError;

  const tryLoad = async (target, options) => {
    try {
      return await loadCached(target);
    } catch (error) {
      if (!shouldFallBack(options.resolution, error)) {
        throw error;
      }
      logger.warn(
        `${label} definition ${target.grantCode}@${target.version} is unusable, falling back to an older version`,
      );
      return null;
    }
  };

  return {
    load: async (options) => {
      const attempted = new Set();

      // Stop when resolution repeats rather than imposing a fallback limit.
      for (;;) {
        const target = await resolveTarget(options);
        const key = `${target.grantCode}@${target.version}`;

        if (attempted.has(key)) {
          break;
        }
        attempted.add(key);

        const definition = await tryLoad(target, options);
        if (definition) {
          return definition;
        }
      }

      logger.error(
        { event: { action: `${definitionType}-definition-unavailable` } },
        `No usable ${label} definition for ${options.code} at or below ${options.configVersion}`,
      );
      throw missing(options.code, options.configVersion);
    },

    clearCaches: () => {
      compiled.clear();
      loadsInFlight.clear();
    },
  };
};
